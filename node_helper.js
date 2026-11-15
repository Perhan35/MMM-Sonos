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

module.exports = NodeHelper.create({
  start: function () {
    console.log('Sonos helper started ...');
    this.url = null;
    this.webhookTimer = null;
    this.fetching = false;     // a request is running
    this.fetchAgain = false;   // another one was asked meanwhile
    this.forceSend = false;    // send even if data did not change
    this.lastSent = null;      // JSON of the last data sent
    this.registerWebhook();
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

  socketNotificationReceived: function(notification, url) {
    if (notification === 'SONOS_UPDATE') {
      this.url = url;
      this.fetchZones(true);
    }
  }
});
