/* Magic Mirror 2
 * Module: MMM-Sonos
 *
 * By Christopher Fenner https://github.com/CFenner
 * Modified by Snille https://github.com/Snille
 * MIT Licensed.
 */
 Module.register('MMM-Sonos', {
	defaults: {
		showStoppedRoom: true,
		showAlbumArt: true,
		preRoomText: 'Zone: ',
		preArtistText: 'Artist: ',
		preTrackText: 'Track: ',
		preTypeText: 'Source: ',
		showRoomName: true,
		animationSpeed: 1000,
		updateInterval: 0.5, // every 0.5 minutes
		apiBase: 'http://localhost',
		apiAlbumArt:  'http://localhost',
		apiPort: 5005,
		apiEndpoint: 'zones',
 		exclude: []
	},
	start: function() {
		Log.info('Starting module: ' + this.name);
		this.update();
		// refresh every x minutes
		setInterval(
			this.update.bind(this),
			this.config.updateInterval * 60 * 1000);
	},
	update: function(){
		this.sendSocketNotification('SONOS_UPDATE',this.config.apiBase + ":" + this.config.apiPort + "/" + this.config.apiEndpoint);
	},
	render: function(data){
		var text = '';
		$.each(data, function (i, item) {
			var room = '';
			var isGroup = item.members.length > 1;
			if(isGroup){
				$.each(item.members, function (j, member) {
					var isExcluded = this.config.exclude.indexOf(member.roomName) !== -1;
					room += isExcluded?'':(member.roomName + ', ');
				}.bind(this));
				room = room.replace(/, $/,"");
			}else{
				room = item.coordinator.roomName;
				var isExcluded = this.config.exclude.indexOf(room) !== -1;
				room = isExcluded?'':room;
			}
			if(room !== ''){
				var groupMasterUrl = this.getGroupMasterUrl(item.coordinator.uuid);
				var state = item.coordinator.state.playbackState;
				var artist = item.coordinator.state.currentTrack.artist;
				var track = item.coordinator.state.currentTrack.title;
				var trackTooLong = this.track ? this.track.length > 27 : false;
				var uri = item.coordinator.state.currentTrack.uri.toString();
				var cover = this.getCover(uri, item, groupMasterUrl);
				// var streamInfo = item.coordinator.state.currentTrack.streamInfo;
				var type = this.getType(uri, item);
				// var type = item.coordinator.state.currentTrack.type;
				var preroom = this.config.preRoomText;
				var preartist = this.config.preArtistText;
				var pretrack = this.config.preTrackText;
				var pretype = this.config.preTypeText;
				var prestream = this.config.preStreamText;
				var volume =  item.members.length > 1 ? item.coordinator.groupState.volume : item.coordinator.state.volume;
				var elapsedTime = item.coordinator.state.elapsedTime;
				var elapsedTimeFormatted = item.coordinator.state.elapsedTimeFormatted;
				var trackDuration = item.coordinator.state.currentTrack.duration;
				var trackPercent = this.getTrackPercent(elapsedTime, trackDuration);
				var trackDurationFormatted = new Date(trackDuration * 1000).toISOString().substring(11, 19);
				var showDuration = trackDuration === 0 ? false : true;
				text += this.renderRoom(state, pretype, type, preroom, room, preartist, artist, pretrack, track, trackTooLong, cover, volume, elapsedTimeFormatted, trackPercent, trackDurationFormatted, showDuration);
			}
		}.bind(this));
		this.loaded = true;
		// only update dom if content changed
		if(this.dom !== text){
			this.show();
			this.dom = text;
			this.updateDom(this.config.animationSpeed);
		}
		// Hide module if not playing.
		if(text == ''){
			this.hide(this.config.animationSpeed);
		}
	},
	renderRoom: function(state, pretype, type, preroom, roomName, preartist, artist, pretrack, track, trackTooLong, cover, volume, elapsedTimeFormatted, trackPercent, trackDurationFormatted, showDuration) {
		artist = artist?artist:"";
		track = track?track:"";
		cover = cover?cover:"";
		var room = '';
		// show room name if 'showRoomName' is set and PLAYING or 'showStoppedRoom' is set
		if(this.config.showRoomName && (state === 'PLAYING' || this.config.showStoppedRoom)) {
			// room += this.html.room.format(preroom, roomName, volume);
		}	
		// if Sonos Playbar is in TV mode, no title is provided and therefore the room should not be displayed
		var isEmpty = (artist && artist.trim().length) == 0
			&& (track && track.trim().length) == 0
			&& (cover && cover.trim().length) == 0;
		// show song if PLAYING
		if(state === 'PLAYING' && !isEmpty) {
			// room += this.html.type.format(pretype, type.charAt(0).toUpperCase() + type.slice(1));
			room += this.html.song.format(
				this.html.name.format(preartist, artist, pretrack, track, 
					trackTooLong ? "animation" : "", //css class for animation if track name too long 
					this.html.room.format(preroom, roomName, volume),
					this.html.type.format(pretype, type.charAt(0).toUpperCase() + type.slice(1)),
					this.html.progression.format(elapsedTimeFormatted, trackPercent, trackDurationFormatted, showDuration ? "" : "dontShow")
					)+
					// show album art if 'showAlbumArt' is set
					(this.config.showAlbumArt
						?this.html.art.format(cover)
						:''
					)
			);
		}
		return this.html.roomWrapper.format(room);
	},
	html: {
		loading: '<div class="dimmed light small">Loading music ...</div>',
		roomWrapper: '{0}',
		song: '<div class="song">{0}</div>',
		room: '<div class="room xsmall">{0}{1}<img class="volume" src="https://banner2.cleanpng.com/20191025/jkq/transparent-audio-icon-music-icon-sound-icon-5db3dcf0dafe24.942761031572068592897.jpg"/>{2}</div>',
		type: '<div class="type normal small">{0}{1}</div>',
		name: '<div class="name normal small">{5}{6}<div class="title-wrapper"><div class="title {4}">{2}{3}</div></div><div class="artist">{0}{1}</div>{7}</div>',
		progression: '<div class="progression normal small {3}">{0}<progress value="{1}" max="100"></progress>{2}</div>',
		art: '<div class="art"><img src="{0}"/></div>',
	},
	getGroupMasterUrl: function(uuid){
		if (uuid.includes("RINCON_38420B42B75E01400")) { 		//salon 
			return "http://192.168.10.228:1400";
		} else if (uuid.includes("RINCON_542A1BFC967001400")) { // Salle de bain
			return "http://192.168.10.230:1400";
		} else if (uuid.includes("RINCON_542A1BFC97A601400")) { // Cuisine
			return "http://192.168.10.120:1400";
		} else if (uuid.includes("RINCON_542A1BB2FBB401400")) { // Sonos Roam
			return "http://192.168.10.194:1400";
		} else {
			return "";
		}
	},
	getCover: function(uri, item, groupMasterUrl){
		var cover = "";
		if(uri.includes("bluetooth")) {
			cover = "https://img2.freepng.fr/20180320/tdw/kisspng-iphone-bluetooth-near-field-communication-wireless-bluetooth-icon-free-png-5ab17a62029c91.0971765315215806420107.jpg";
		} else if (uri.includes("x-sonos-http:track") || uri.includes("airplay")) {
			cover = item.coordinator.state.currentTrack.absoluteAlbumArtUri;
		} else if (uri.includes("x-sonosapi-stream:tunein") || uri.includes("x-sonosapi-radio:sonos") || uri.includes("x-sonos-spotify:spotify") || uri.includes("x-file-cifs")) {
			cover = groupMasterUrl + item.coordinator.state.currentTrack.albumArtUri;
		} else if (uri.includes("x-sonos-htastream")) {
			cover = "https://w7.pngwing.com/pngs/669/222/png-transparent-tv-illustration-computer-icons-television-computer-keyboard-tv-icon-miscellaneous-angle-text.png";
		} else {
			cover = this.config.apiAlbumArt + item.coordinator.state.currentTrack.albumArtUri;
			//cover = "http://server.perhan.local:5005/sonos-icon.png"
		}
		return cover;
	},
	getType: function(uri, item) {
		var type = "";
		if(uri.includes("x-sonosapi-stream")) {
			type = "TV";
		} else if (uri.includes("x-sonosapi-radio")) {
			type = "Radio";
		} else if (uri.includes("x-sonos-spotify")) {
			type = "Spotify";
		} else if (uri.includes("bluetooth")) {
			type = "Bluetooth";
		} else if (uri.includes("x-file-cifs")) {
			type = "NAS";
		} else if (uri.includes("x-sonos-http:song")) {
			type = "Apple Music";
		} else if (uri.includes("soundcloud")) {
			type = "Soundcloud";
		} else if (uri.includes("cloudcast")) {
			type = "Mixcould";
		} else if (uri.includes("airplay")) {
			type = "AirPlay";
		} else {
			type = item.coordinator.state.currentTrack.type;
		}
		return type;
	},
	getTrackPercent: function(elapsedTime, trackDuration) {
		return (elapsedTime / trackDuration) * 100;
	},
	capitalize: function() {
		return this.charAt(0).toUpperCase() + this.slice(1);
	},
	getScripts: function() {
		return [
			'String.format.js',
			'//cdnjs.cloudflare.com/ajax/libs/jquery/2.2.2/jquery.js'
		];
	},
	getStyles: function() {
		return ['sonos.css'];
	},
	getDom: function() {
		var content = '';
		if (!this.loaded) {
			content = this.html.loading;
		}else if(this.data.position.endsWith("left")){
			content = '<ul class="flip">'+this.dom+'</ul>';
		}else{
			content = '<ul>'+this.dom+'</ul>';
		}
		return $('<div class="sonos">'+content+'</div>')[0];
	},
	socketNotificationReceived: function(notification, payload) {
	if (notification === 'SONOS_DATA') {
		//Log.info('received SONOS_DATA');
		this.render(payload);
      }
  }
});
