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
		speakerUrls: {}, // optional: { 'Living Room': 'http://<ip>:1400' }
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
		(Array.isArray(data) ? data : []).forEach(function (item) {
			var room = '';
			var isGroup = item.members.length > 1;
			if(isGroup){
				item.members.forEach(function (member) {
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
				var state = item.coordinator.state.playbackState;
				var artist = item.coordinator.state.currentTrack.artist;
				var track = item.coordinator.state.currentTrack.title;
				var trackTooLong = this.track ? this.track.length > 27 : false;
				var uri = item.coordinator.state.currentTrack.uri.toString();
				var cover = this.getCover(uri, item);
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
						?(cover.indexOf('icon:') === 0
							?this.html.artIcon.format(cover.slice(5))
							:this.html.art.format(cover))
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
		room: '<div class="room xsmall">{0}{1}<i class="fa-solid fa-volume-high volume"></i>{2}</div>',
		type: '<div class="type normal small">{0}{1}</div>',
		name: '<div class="name normal small">{5}{6}<div class="title-wrapper"><div class="title {4}">{2}{3}</div></div><div class="artist">{0}{1}</div>{7}</div>',
		progression: '<div class="progression normal small {3}">{0}<progress value="{1}" max="100"></progress>{2}</div>',
		art: '<div class="art"><img src="{0}"/></div>',
		artIcon: '<div class="art"><i class="{0}"></i></div>',
	},
	// Base URL ("http://<ip>:1400") of a speaker, from the optional
	// 'speakerUrls' config, keyed by room name or UUID.
	getSpeakerUrl: function(coordinator){
		var urls = this.config.speakerUrls || {};
		return urls[coordinator.roomName] || urls[coordinator.uuid] || '';
	},
	getCover: function(uri, item){
		var track = item.coordinator.state.currentTrack;
		if (uri.includes("bluetooth")) {
			// Font Awesome icon instead of an image (see renderRoom)
			return "icon:fa-brands fa-bluetooth";
		}
		if (uri.includes("x-sonos-htastream")) {
			return "https://w7.pngwing.com/pngs/669/222/png-transparent-tv-illustration-computer-icons-television-computer-keyboard-tv-icon-miscellaneous-angle-text.png";
		}
		if (uri.includes("x-rincon-stream")) {
			return "https://www.pioneerdj.com/-/media/pioneerdj/images/features/controller/ddj-flx4/ddj-flx4_hotspot_top_pc.png";
		}
		// node-sonos-http-api already resolves the full URL
		// (speaker address + path, or a high-res cover).
		if (track.absoluteAlbumArtUri) {
			return track.absoluteAlbumArtUri;
		}
		var art = track.albumArtUri || "";
		if (art === "" || /^https?:\/\//.test(art)) {
			return art;
		}
		// Relative path: served by the speaker itself.
		return (this.getSpeakerUrl(item.coordinator) || this.config.apiAlbumArt) + art;
	},
	getType: function(uri, item) {
		var type = "";
		if(uri.includes("x-sonosapi-stream")) {
			type = "TV";
		} else if (uri.includes("x-sonosapi-radio")) {
			type = "Radio";
		} else if (uri.includes("x-sonos-spotify")) {
			type = "Spotify";
		} else if (uri.includes("x-rincon-stream")) {
			type = "Line-in";
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
			'String.format.js'
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
		var wrapper = document.createElement('div');
		wrapper.className = 'sonos';
		wrapper.innerHTML = content;
		return wrapper;
	},
	socketNotificationReceived: function(notification, payload) {
	if (notification === 'SONOS_DATA') {
		//Log.info('received SONOS_DATA');
		this.render(payload);
      }
  }
});
