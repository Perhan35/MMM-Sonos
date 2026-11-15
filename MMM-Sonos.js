/* MagicMirror²
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
Module.register('MMM-Sonos', {
	defaults: {
		showAlbumArt: true,
		showRoomName: true,
		preRoomText: 'Zone: ',
		preArtistText: 'Artist: ',
		preTrackText: 'Track: ',
		preTypeText: 'Source: ',
		animationSpeed: 1000,
		updateInterval: 0.5, // minutes
		apiBase: 'http://localhost',
		apiPort: 5005,
		apiEndpoint: 'zones',
		apiAlbumArt: 'http://localhost',
		useEvents: true, // real-time updates from the API's /events
		speakerUrls: {}, // optional: { 'Living Room': 'http://<ip>:1400' }
		sourceArt: {}, // optional: { 'Line-in': 'https://.../image.png' }
		proxyAlbumArt: true, // the mirror fetches the album art for the browser
		exclude: []
	},

	// Titles longer than this scroll (see .title.animation in sonos.css).
	MAX_TITLE_LENGTH: 27,

	// Picture for sources without album art: Font Awesome classes.
	// Can be replaced per source with the 'sourceArt' config.
	SOURCE_ICONS: {
		TV: 'fa-solid fa-tv',
		'Line-in': 'fa-solid fa-plug',
		Bluetooth: 'fa-brands fa-bluetooth'
	},

	// First match wins: keep the more specific patterns first.
	SOURCE_TYPES: [
		['x-sonos-htastream', 'TV'],
		['x-sonosapi-stream', 'Radio'],
		['x-sonosapi-radio', 'Radio'],
		['x-sonos-spotify', 'Spotify'],
		['bluetooth', 'Bluetooth'],
		['x-rincon-stream', 'Line-in'],
		['x-file-cifs', 'NAS'],
		['x-sonos-http:song', 'Apple Music'],
		['soundcloud', 'Soundcloud'],
		['cloudcast', 'Mixcloud'],
		['airplay', 'AirPlay']
	],

	start() {
		Log.info(`Starting module: ${this.name}`);
		this.clocks = {};
		this.update();
		setInterval(() => this.update(), this.config.updateInterval * 60 * 1000);
		// move the progress bar every second, between two API updates
		setInterval(() => this.tick(), 1000);
	},

	update() {
		const { apiBase, apiPort, apiEndpoint, useEvents, apiAlbumArt } = this.config;
		// addresses the album art proxy may fetch from
		const artOrigins = [
			...Object.values(this.config.speakerUrls || {}),
			...Object.values(this.config.sourceArt || {}).filter((art) => !art.startsWith('fa-')),
			apiAlbumArt
		];
		this.sendSocketNotification('SONOS_UPDATE', { apiBase, apiPort, apiEndpoint, useEvents, artOrigins });
	},

	socketNotificationReceived(notification, payload) {
		if (notification === 'SONOS_DATA') {
			this.render(payload);
		}
	},

	render(data, now = Date.now()) {
		const clocks = {};
		let text = '';
		(Array.isArray(data) ? data : []).forEach((item) => {
			const room = this.getRoomName(item);
			if (room !== '') {
				text += this.renderZone(item, room, now, clocks);
			}
		});
		// only playing zones keep a clock: a paused zone starts fresh
		this.clocks = clocks;
		this.loaded = true;
		// hide module if nothing is playing
		if (text === '') {
			this.dom = text;
			if (!this.hidden) {
				this.hide(this.config.animationSpeed);
			}
			return;
		}
		// only update dom if content changed; fade only when the song
		// changes, not when just the progress bar moves (cheaper on a Pi)
		if (this.dom !== text) {
			const songChanged = this.withoutProgress(this.dom) !== this.withoutProgress(text);
			this.dom = text;
			this.updateDom(songChanged ? this.config.animationSpeed : 0);
		}
		if (this.hidden) {
			this.show(this.config.animationSpeed);
		}
	},

	withoutProgress(html) {
		return (html || '').replace(/<div class="progression[^>]*>.*?<\/div>/g, '');
	},

	// Names of the zone's rooms, without the excluded ones ('' if all excluded).
	getRoomName(item) {
		const exclude = this.config.exclude;
		return item.members
			.map((member) => member.roomName)
			.filter((name) => !exclude.includes(name))
			.join(', ');
	},

	renderZone(item, room, now, clocks) {
		const coordinator = item.coordinator;
		const state = coordinator.state;
		const track = state.currentTrack || {};
		const artist = track.artist || '';
		const title = track.title || '';
		const uri = String(track.uri || '');
		const type = this.getType(uri, track);
		const cover = this.getCover(item, type);

		// show only playing zones; skip when there is nothing to show
		if (state.playbackState !== 'PLAYING' || (!artist.trim() && !title.trim() && !cover.trim())) {
			return '';
		}

		const duration = track.duration || 0;
		const clock = this.getClock(clocks, coordinator.uuid, uri, state.elapsedTime, now);
		const elapsed = Math.min(clock.elapsed + (now - clock.at) / 1000, duration || Infinity);
		const e = (value) => this.escape(value);
		// pre*Text come from the user's config: HTML (e.g. an icon) is allowed there

		const roomHtml = this.config.showRoomName
			? `<div class="room xsmall">${this.config.preRoomText}${e(room)}${this.renderVolume(item)}</div>`
			: '';
		const typeHtml = `<div class="type normal small">${this.config.preTypeText}${e(type)}</div>`;
		const progressHtml = `<div class="progression normal small${duration > 0 ? '' : ' dontShow'}"`
			+ ` data-elapsed="${clock.elapsed}" data-at="${clock.at}" data-duration="${duration}">`
			+ `<span class="elapsed">${this.formatDuration(elapsed)}</span>`
			+ `<progress value="${this.getTrackPercent(elapsed, duration)}" max="100"></progress>`
			+ `<span class="duration">${this.formatDuration(duration)}</span></div>`;
		const scroll = title.length > this.MAX_TITLE_LENGTH ? ' animation' : '';
		const nameHtml = `<div class="name normal small">${roomHtml}${typeHtml}`
			+ `<div class="title-wrapper${scroll ? ' scrolling' : ''}"><div class="title${scroll}">${this.config.preTrackText}${e(title)}</div></div>`
			+ `<div class="artist">${this.config.preArtistText}${e(artist)}</div>`
			+ `${progressHtml}</div>`;

		let artHtml = '';
		if (this.config.showAlbumArt && cover !== '') {
			artHtml = cover.startsWith('fa-')
				? `<div class="art"><i class="${e(cover)}"></i></div>`
				: `<div class="art"><img src="${e(cover)}" decoding="async"/></div>`;
		}
		return `<div class="song">${nameHtml}${artHtml}</div>`;
	},

	renderVolume(item) {
		const group = item.members.length > 1;
		const coordinator = item.coordinator;
		const source = group ? coordinator.groupState || {} : coordinator.state;
		const volume = source.volume;
		const icon = source.mute || volume === 0 ? 'fa-volume-xmark' : 'fa-volume-high';
		return `<i class="fa-solid ${icon} volume"></i>${this.escape(volume === undefined ? '' : volume)}`;
	},

	// Where the song was when the API last told us (elapsed, at), so the
	// progress bar can move on its own. If the API sends the same elapsed
	// time again (not refreshed since), keep the old clock running.
	getClock(clocks, uuid, uri, apiElapsed, now) {
		const elapsed = apiElapsed || 0;
		const old = this.clocks[uuid];
		const clock = old && old.uri === uri && old.elapsed === elapsed
			? old
			: { uri, elapsed, at: now };
		clocks[uuid] = clock;
		return clock;
	},

	tick(now = Date.now()) {
		if (this.hidden || !this.loaded) {
			return;
		}
		document.querySelectorAll(`#${this.identifier} .progression`).forEach((node) => {
			const duration = Number(node.dataset.duration);
			if (!(duration > 0)) {
				return;
			}
			const elapsed = Math.min(Number(node.dataset.elapsed) + (now - Number(node.dataset.at)) / 1000, duration);
			node.querySelector('.elapsed').textContent = this.formatDuration(elapsed);
			node.querySelector('progress').value = this.getTrackPercent(elapsed, duration);
		});
	},

	// Base URL ("http://<ip>:1400") of a speaker, from the optional
	// 'speakerUrls' config, keyed by room name or UUID.
	getSpeakerUrl(coordinator) {
		const urls = this.config.speakerUrls || {};
		return urls[coordinator.roomName] || urls[coordinator.uuid] || '';
	},

	// Image URL, or Font Awesome classes (starting with "fa-"), or ''.
	getCover(item, type) {
		const custom = (this.config.sourceArt || {})[type];
		if (custom) {
			return custom.startsWith('fa-') ? custom : this.artSrc(custom);
		}
		if (this.SOURCE_ICONS[type]) {
			return this.SOURCE_ICONS[type];
		}
		const track = item.coordinator.state.currentTrack || {};
		// node-sonos-http-api already resolves the full URL
		// (speaker address + path, or a high-res cover).
		if (track.absoluteAlbumArtUri) {
			return this.artSrc(track.absoluteAlbumArtUri);
		}
		const art = track.albumArtUri || '';
		if (art === '' || /^https?:\/\//.test(art)) {
			return this.artSrc(art);
		}
		// relative path: served by the speaker itself
		return this.artSrc((this.getSpeakerUrl(item.coordinator) || this.config.apiAlbumArt) + art);
	},

	// Album art through the mirror (see node_helper.js): works even when the
	// browser cannot reach the speakers or the internet. Relative URL, so it
	// also works with a basePath.
	artSrc(url) {
		if (!url || !this.config.proxyAlbumArt) {
			return url;
		}
		return `${this.name}/albumart?url=${encodeURIComponent(url)}`;
	},

	getType(uri, track) {
		const match = this.SOURCE_TYPES.find(([pattern]) => uri.includes(pattern));
		const type = match ? match[1] : String(track.type || '');
		return type.charAt(0).toUpperCase() + type.slice(1);
	},

	getTrackPercent(elapsed, duration) {
		return duration > 0 ? (elapsed || 0) / duration * 100 : 0;
	},

	// seconds -> "m:ss", or "h:mm:ss" for an hour or more
	formatDuration(seconds) {
		const total = Math.max(0, Math.floor(seconds || 0));
		const h = Math.floor(total / 3600);
		const m = Math.floor(total / 60) % 60;
		const s = String(total % 60).padStart(2, '0');
		return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
	},

	escape(text) {
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	},

	getStyles() {
		return ['sonos.css'];
	},

	getDom() {
		let content;
		if (!this.loaded) {
			content = '<div class="dimmed light small">Loading music ...</div>';
		} else if ((this.data.position || '').endsWith('left')) {
			content = `<ul class="flip">${this.dom}</ul>`;
		} else {
			content = `<ul>${this.dom}</ul>`;
		}
		const wrapper = document.createElement('div');
		wrapper.className = 'sonos';
		wrapper.innerHTML = content;
		return wrapper;
	}
});
