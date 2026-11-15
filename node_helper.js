/* MagicMirror²
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
const http = require('node:http');
const https = require('node:https');
const NodeHelper = require('node_helper');

// node-sonos-http-api sends events in bursts (one per group member, plus
// volume/topology changes): wait a bit and refresh only once.
const REFRESH_DEBOUNCE_MS = 300;
const FETCH_TIMEOUT_MS = 10000;
// After this many failed requests in a row, hide the old song.
const MAX_FAILURES = 3;
// /events reconnect delays: quick after a normal drop, slow when the API
// is down or too old to have /events (404).
const EVENTS_RETRY_MS = 2000;
const EVENTS_RETRY_MAX_MS = 5 * 60 * 1000;
const MAX_ART_BYTES = 5 * 1024 * 1024;
const ART_CACHE_SECONDS = 86400;

// Reads a chunk of a server-sent events stream. Returns the unfinished
// last line (to prepend to the next chunk) and whether a "data:" line was
// seen. Comment / heartbeat lines (":") do not count as a change.
function readEvents(buffer) {
	const lines = buffer.split(/\r?\n/);
	const rest = lines.pop();
	return { rest, changed: lines.some((line) => line.startsWith('data:')) };
}

module.exports = NodeHelper.create({
	readEvents,

	start() {
		console.log('Sonos helper started ...');
		this.zonesUrl = null;
		this.eventsUrl = null;
		this.eventsRequest = null;
		this.eventsRetryMs = EVENTS_RETRY_MS;
		this.refreshTimer = null;
		this.fetching = false;   // a request is running
		this.fetchAgain = false; // another one was asked meanwhile
		this.forceSend = false;  // send even if data did not change
		this.lastSent = null;    // JSON of the last data sent
		this.failures = 0;       // failed requests in a row
		this.stopped = false;
		this.artUrls = new Set();        // album art URLs given by the API
		this.artOrigins = new Set();     // speaker addresses ("http://<ip>:1400")
		this.configOrigins = new Set();  // speakerUrls / apiAlbumArt from config
		this.registerWebhook();
		this.registerAlbumArtProxy();
	},

	stop() {
		this.stopped = true;
		clearTimeout(this.refreshTimer);
		clearTimeout(this.eventsTimer);
		if (this.eventsRequest) {
			this.eventsRequest.destroy();
		}
	},

	// Older way to get real-time updates (the /events stream is simpler):
	// node-sonos-http-api's "webhook" setting can POST here on every event.
	registerWebhook() {
		const path = `/${this.name}/webhook`;
		this.expressApp.post(path, (req, res) => {
			res.sendStatus(200);
			this.scheduleRefresh();
		});
	},

	// Album art proxy: the browser showing the mirror may not reach the
	// speakers (other VLAN, no internet, or http images on an https page).
	// The mirror fetches the image itself and serves it. Only URLs the Sonos
	// API gave, or URLs on a known speaker, are fetched: not an open proxy.
	registerAlbumArtProxy() {
		this.expressApp.get(`/${this.name}/albumart`, (req, res) => {
			const url = typeof req.query.url === 'string' ? req.query.url : '';
			if (!this.isAllowedArt(url)) {
				res.sendStatus(403);
				return;
			}
			fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
				.then((response) => {
					const type = response.headers.get('content-type') || '';
					if (!response.ok || !type.startsWith('image/')) {
						throw new Error(`HTTP ${response.status} ${type}`);
					}
					return response.arrayBuffer().then((buffer) => {
						if (buffer.byteLength > MAX_ART_BYTES) {
							throw new Error('image too big');
						}
						res.set('Content-Type', type);
						res.set('Cache-Control', `public, max-age=${ART_CACHE_SECONDS}`);
						res.send(Buffer.from(buffer));
					});
				})
				.catch((error) => {
					console.error(`Failure sonos album art: ${error.message}`);
					if (!res.headersSent) {
						res.sendStatus(502);
					}
				});
		});
	},

	originOf(url) {
		try {
			const u = new URL(url);
			return (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin : '';
		} catch {
			return '';
		}
	},

	isAllowedArt(url) {
		const origin = this.originOf(url);
		if (!origin) {
			return false;
		}
		return this.artUrls.has(url) || this.artOrigins.has(origin) || this.configOrigins.has(origin);
	},

	// Remember the album art URLs of the last answer (and the speakers they
	// come from), so the proxy knows what it may fetch.
	rememberArt(zones) {
		(Array.isArray(zones) ? zones : []).forEach((zone) => {
			const t = ((zone.coordinator || {}).state || {}).currentTrack || {};
			[t.absoluteAlbumArtUri, t.albumArtUri].forEach((url) => {
				if (typeof url !== 'string' || !this.originOf(url)) {
					return;
				}
				this.artUrls.add(url);
				// Sonos serves the art itself on /getaa: that origin is a speaker
				if (new URL(url).pathname === '/getaa') {
					this.artOrigins.add(this.originOf(url));
				}
			});
		});
		if (this.artUrls.size > 500) {
			this.artUrls = new Set(Array.from(this.artUrls).slice(-200));
		}
	},

	scheduleRefresh() {
		if (!this.zonesUrl) {
			return; // frontend not started yet, nothing to refresh
		}
		clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => this.fetchZones(false), REFRESH_DEBOUNCE_MS);
	},

	// Real-time updates: keep a connection open to node-sonos-http-api's
	// /events (server-sent events) and refresh the zones on every event.
	connectEvents() {
		const client = this.eventsUrl.startsWith('https:') ? https : http;
		let connected = false;
		let retried = false;
		const retry = (message) => {
			if (retried || this.stopped) {
				return;
			}
			retried = true;
			this.eventsRequest = null;
			if (connected) {
				// normal drop (API restarted, network blip): come back fast
				console.log(`Sonos events: connection closed (${message}), reconnecting`);
				this.eventsRetryMs = EVENTS_RETRY_MS;
			} else {
				if (this.eventsRetryMs === EVENTS_RETRY_MS) {
					console.error(`Sonos events: cannot connect to ${this.eventsUrl} (${message}), retrying in the background`);
				}
				this.eventsRetryMs = Math.min(this.eventsRetryMs * 2, EVENTS_RETRY_MAX_MS);
			}
			this.eventsTimer = setTimeout(() => this.connectEvents(), connected ? EVENTS_RETRY_MS : this.eventsRetryMs);
		};

		const request = client.get(this.eventsUrl, { headers: { Accept: 'text/event-stream' } }, (res) => {
			if (res.statusCode !== 200) {
				res.resume();
				retry(`HTTP ${res.statusCode}`);
				return;
			}
			connected = true;
			this.eventsRetryMs = EVENTS_RETRY_MS;
			console.log(`Sonos events: connected to ${this.eventsUrl}`);
			// we may have missed changes while disconnected
			this.scheduleRefresh();
			let buffer = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => {
				const result = readEvents(buffer + chunk);
				buffer = result.rest;
				if (result.changed) {
					this.scheduleRefresh();
				}
			});
			res.on('end', () => retry('ended'));
			res.on('error', (error) => retry(error.message));
		});
		request.on('error', (error) => retry(error.message));
		this.eventsRequest = request;
	},

	// force: send the data even if it did not change (the frontend asked,
	// e.g. a new browser window). Event refreshes only send real changes.
	fetchZones(force) {
		this.forceSend = this.forceSend || force;
		if (this.fetching) {
			// slow API or slow device: never run two requests at once
			this.fetchAgain = true;
			return;
		}
		this.fetching = true;
		fetch(this.zonesUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
			.then((response) => {
				if (!response.ok) {
					throw new Error(`HTTP ${response.status}`);
				}
				return response.json();
			})
			.then((data) => {
				this.failures = 0;
				this.rememberArt(data);
				this.send(this.slimZones(data));
			})
			.catch((error) => {
				this.failures++;
				console.error(`Failure sonos: ${error.message}`);
				if (this.failures >= MAX_FAILURES) {
					// API gone: do not leave the last song on screen forever
					this.send([]);
				}
			})
			.finally(() => {
				this.fetching = false;
				if (this.fetchAgain) {
					this.fetchAgain = false;
					this.fetchZones(false);
				}
			});
	},

	send(zones) {
		const json = JSON.stringify(zones);
		if (this.forceSend || json !== this.lastSent) {
			this.lastSent = json;
			this.forceSend = false;
			this.sendSocketNotification('SONOS_DATA', zones);
		}
	},

	// The zones answer is big (full state of every speaker): keep only what
	// the frontend shows, so less data goes over the socket and to the browser.
	slimZones(zones) {
		return (Array.isArray(zones) ? zones : []).map((zone) => {
			const c = zone.coordinator || {};
			const state = c.state || {};
			const group = c.groupState || {};
			const t = state.currentTrack || {};
			return {
				members: (zone.members || []).map((m) => ({ roomName: m.roomName })),
				coordinator: {
					uuid: c.uuid,
					roomName: c.roomName,
					groupState: { volume: group.volume, mute: group.mute },
					state: {
						playbackState: state.playbackState,
						volume: state.volume,
						mute: state.mute,
						elapsedTime: state.elapsedTime,
						currentTrack: {
							uri: t.uri,
							type: t.type,
							artist: t.artist,
							title: t.title,
							duration: t.duration,
							albumArtUri: t.albumArtUri,
							absoluteAlbumArtUri: t.absoluteAlbumArtUri
						}
					}
				}
			};
		});
	},

	socketNotificationReceived(notification, payload) {
		if (notification !== 'SONOS_UPDATE') {
			return;
		}
		const base = `${payload.apiBase}:${payload.apiPort}`;
		(Array.isArray(payload.artOrigins) ? payload.artOrigins : []).forEach((url) => {
			const origin = this.originOf(url);
			if (origin) {
				this.configOrigins.add(origin);
			}
		});
		this.zonesUrl = `${base}/${payload.apiEndpoint}`;
		if (payload.useEvents && !this.eventsUrl) {
			this.eventsUrl = `${base}/events`;
			this.connectEvents();
		}
		this.fetchZones(true);
	}
});
