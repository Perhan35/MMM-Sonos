/* Magic Mirror 2
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
var NodeHelper = require('node_helper');

// node-sonos-http-api sends events in bursts (one per group member, plus
// volume/topology changes): wait a bit and refresh only once.
var WEBHOOK_DEBOUNCE_MS = 300;
var FETCH_TIMEOUT_MS = 10000;
var MAX_ART_BYTES = 5 * 1024 * 1024;
var ART_CACHE_SECONDS = 86400;

module.exports = NodeHelper.create({
  start: function () {
    console.log('Sonos helper started ...');
    this.url = null;
    this.webhookTimer = null;
    this.fetching = false;     // a request is running
    this.fetchAgain = false;   // another one was asked meanwhile
    this.forceSend = false;    // send even if data did not change
    this.lastSent = null;      // JSON of the last data sent
    this.artUrls = new Set();     // album art URLs given by the API
    this.artOrigins = new Set();  // speaker addresses ("http://<ip>:1400")
    this.configOrigins = new Set(); // speakerUrls / apiAlbumArt from config
    this.registerWebhook();
    this.registerAlbumArtProxy();
  },

  // Real-time updates: point node-sonos-http-api's "webhook" setting to
  // http://<mirror>:<port>/MMM-Sonos/webhook and it will POST here on every
  // Sonos event. The body is not needed: we just re-fetch the zones.
  registerWebhook: function() {
    var self = this;
    var path = '/' + this.name + '/webhook';
    this.expressApp.post(path, function(req, res) {
      res.sendStatus(200);
      if (!self.url) {
        return; // frontend not started yet, nothing to refresh
      }
      clearTimeout(self.webhookTimer);
      self.webhookTimer = setTimeout(function() {
        self.fetchZones(false);
      }, WEBHOOK_DEBOUNCE_MS);
    });
    console.log('Sonos webhook listening on ' + path);
  },

  // Album art proxy: the browser showing the mirror may not reach the
  // speakers (other VLAN, no internet, or http images on an https page).
  // The mirror fetches the image itself and serves it. Only URLs the Sonos
  // API gave, or URLs on a known speaker, are fetched: not an open proxy.
  registerAlbumArtProxy: function() {
    var self = this;
    this.expressApp.get('/' + this.name + '/albumart', function(req, res) {
      var url = typeof req.query.url === 'string' ? req.query.url : '';
      if (!self.isAllowedArt(url)) {
        res.sendStatus(403);
        return;
      }
      fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
        .then(function(response) {
          var type = response.headers.get('content-type') || '';
          if (!response.ok || type.indexOf('image/') !== 0) {
            throw new Error('HTTP ' + response.status + ' ' + type);
          }
          return response.arrayBuffer().then(function(buffer) {
            if (buffer.byteLength > MAX_ART_BYTES) {
              throw new Error('image too big');
            }
            res.set('Content-Type', type);
            res.set('Cache-Control', 'public, max-age=' + ART_CACHE_SECONDS);
            res.send(Buffer.from(buffer));
          });
        })
        .catch(function(error) {
          console.error('Failure sonos album art: ' + error.message);
          if (!res.headersSent) {
            res.sendStatus(502);
          }
        });
    });
  },

  originOf: function(url) {
    try {
      var u = new URL(url);
      return (u.protocol === 'http:' || u.protocol === 'https:') ? u.origin : '';
    } catch (e) {
      return '';
    }
  },

  isAllowedArt: function(url) {
    var origin = this.originOf(url);
    if (!origin) {
      return false;
    }
    return this.artUrls.has(url) || this.artOrigins.has(origin) || this.configOrigins.has(origin);
  },

  // Remember the album art URLs of the last answer (and the speakers they
  // come from), so the proxy knows what it may fetch.
  rememberArt: function(zones) {
    var self = this;
    (Array.isArray(zones) ? zones : []).forEach(function(zone) {
      var t = ((zone.coordinator || {}).state || {}).currentTrack || {};
      [t.absoluteAlbumArtUri, t.albumArtUri].forEach(function(url) {
        if (typeof url !== 'string' || !self.originOf(url)) {
          return;
        }
        self.artUrls.add(url);
        // Sonos serves the art itself on /getaa: that origin is a speaker
        if (new URL(url).pathname === '/getaa') {
          self.artOrigins.add(self.originOf(url));
        }
      });
    });
    if (this.artUrls.size > 500) {
      this.artUrls = new Set(Array.from(this.artUrls).slice(-200));
    }
  },

  // force: send the data even if it did not change (the frontend asked,
  // e.g. a new browser window). Webhook calls only send real changes.
  fetchZones: function(force) {
    var self = this;
    this.forceSend = this.forceSend || force;
    if (this.fetching) {
      // slow API or slow device: never run two requests at once
      this.fetchAgain = true;
      return;
    }
    this.fetching = true;
    fetch(this.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
      .then(function(response) {
        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }
        return response.json();
      })
      .then(function(data) {
        self.rememberArt(data);
        var json = JSON.stringify(self.slimZones(data));
        if (self.forceSend || json !== self.lastSent) {
          self.lastSent = json;
          self.forceSend = false;
          self.sendSocketNotification('SONOS_DATA', JSON.parse(json));
        }
      })
      .catch(function(error) {
        console.error('Failure sonos: ' + error.message);
      })
      .finally(function() {
        self.fetching = false;
        if (self.fetchAgain) {
          self.fetchAgain = false;
          self.fetchZones(false);
        }
      });
  },

  // The zones answer is big (full state of every speaker): keep only what
  // the frontend shows, so less data goes over the socket and to the browser.
  slimZones: function(zones) {
    return (Array.isArray(zones) ? zones : []).map(function(zone) {
      var c = zone.coordinator || {};
      var state = c.state || {};
      var t = state.currentTrack || {};
      return {
        members: (zone.members || []).map(function(m) { return { roomName: m.roomName }; }),
        coordinator: {
          uuid: c.uuid,
          roomName: c.roomName,
          groupState: { volume: (c.groupState || {}).volume },
          state: {
            playbackState: state.playbackState,
            volume: state.volume,
            elapsedTime: state.elapsedTime,
            elapsedTimeFormatted: state.elapsedTimeFormatted,
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

  // payload: { url, artOrigins } (a plain URL string still works)
  socketNotificationReceived: function(notification, payload) {
    if (notification === 'SONOS_UPDATE') {
      var self = this;
      var data = typeof payload === 'string' ? { url: payload } : (payload || {});
      this.url = data.url;
      (Array.isArray(data.artOrigins) ? data.artOrigins : []).forEach(function(url) {
        var origin = self.originOf(url);
        if (origin) {
          self.configOrigins.add(origin);
        }
      });
      this.fetchZones(true);
    }
  }
});
