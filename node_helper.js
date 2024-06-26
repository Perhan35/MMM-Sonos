/* Magic Mirror 2
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
var NodeHelper = require('node_helper');
var request = require('request');

module.exports = NodeHelper.create({
  start: function () {
    console.log('Sonos helper started ...');
  },
  //Subclass socketNotificationReceived received.
  socketNotificationReceived: function(notification, url) {
    if (notification === 'SONOS_UPDATE') {
      var self = this;
      request(url, function(error, response, body) {
        if (!error && response.statusCode == 200) {
          self.sendSocketNotification('SONOS_DATA', JSON.parse(body));
        } else {
      		console.error('Failure sonos: ' + error);
        }
      });
    }
  }
});
