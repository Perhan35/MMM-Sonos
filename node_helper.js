/* Magic Mirror 2
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
var NodeHelper = require('node_helper');
var request = require('request');

// node-sonos-http-api sends events in bursts (one per group member, plus
// volume/topology changes): wait a bit and refresh only once.
var WEBHOOK_DEBOUNCE_MS = 300;

module.exports = NodeHelper.create({
  start: function () {
    console.log('Sonos helper started ...');
    this.url = null;
    this.webhookTimer = null;
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
        self.fetchZones();
      }, WEBHOOK_DEBOUNCE_MS);
    });
    console.log('Sonos webhook listening on ' + path);
  },

  fetchZones: function() {
    var self = this;
    request(this.url, function(error, response, body) {
      if (error || response.statusCode != 200) {
        console.error('Failure sonos: ' + (error || ('HTTP ' + response.statusCode)));
        return;
      }
      var data;
      try {
        data = JSON.parse(body);
      } catch (e) {
        console.error('Failure sonos: invalid JSON (' + e.message + ')');
        return;
      }
      self.sendSocketNotification('SONOS_DATA', data);
    });
  },

  //Subclass socketNotificationReceived received.
  socketNotificationReceived: function(notification, url) {
    if (notification === 'SONOS_UPDATE') {
      this.url = url;
      this.fetchZones();
    }
  }
});
