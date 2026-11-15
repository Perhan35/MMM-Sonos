/* Magic Mirror 2
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
		speakerUrls: {}, // optional: { 'Living Room': 'http://<ip>:1400' }
		proxyAlbumArt: true, // the mirror fetches the album art for the browser
		exclude: []
	},

	// Titles longer than this get the "animation" CSS class.
	MAX_TITLE_LENGTH: 27,

	html: {
		loading: '<div class="dimmed light small">Loading music ...</div>',
		room: '<div class="room xsmall">{0}{1}<i class="fa-solid fa-volume-high volume"></i>{2}</div>',
		type: '<div class="type normal small">{0}{1}</div>',
		name: '<div class="name normal small">{5}{6}<div class="title-wrapper"><div class="title {4}">{2}{3}</div></div><div class="artist">{0}{1}</div>{7}</div>',
		progression: '<div class="progression normal small {3}">{0}<progress value="{1}" max="100"></progress>{2}</div>',
		art: '<div class="art"><img src="{0}" decoding="async"/></div>',
		artIcon: '<div class="art"><i class="{0}"></i></div>'
	},

	start: function() {
		Log.info('Starting module: ' + this.name);
		this.update();
		setInterval(this.update.bind(this), this.config.updateInterval * 60 * 1000);
	},

	update: function() {
		var url = this.config.apiBase + ':' + this.config.apiPort + '/' + this.config.apiEndpoint;
		var speakerUrls = this.config.speakerUrls || {};
		var artOrigins = Object.keys(speakerUrls).map(function(key) { return speakerUrls[key]; });
		artOrigins.push(this.config.apiAlbumArt);
		this.sendSocketNotification('SONOS_UPDATE', { url: url, artOrigins: artOrigins });
	},

	socketNotificationReceived: function(notification, payload) {
		if (notification === 'SONOS_DATA') {
			this.render(payload);
		}
	},

	render: function(data) {
		var text = '';
		(Array.isArray(data) ? data : []).forEach(function(item) {
			var room = this.getRoomName(item);
			if (room !== '') {
				text += this.renderZone(item, room);
			}
		}.bind(this));
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
			var songChanged = this.withoutProgress(this.dom) !== this.withoutProgress(text);
			this.dom = text;
			this.updateDom(songChanged ? this.config.animationSpeed : 0);
		}
		if (this.hidden) {
			this.show(this.config.animationSpeed);
		}
	},

	withoutProgress: function(html) {
		return (html || '').replace(/<div class="progression[^>]*>.*?<\/div>/g, '');
	},

	// Names of the zone's rooms, without the excluded ones ('' if all excluded).
	getRoomName: function(item) {
		var exclude = this.config.exclude;
		return item.members
			.map(function(member) { return member.roomName; })
			.filter(function(name) { return exclude.indexOf(name) === -1; })
			.join(', ');
	},

	renderZone: function(item, room) {
		var state = item.coordinator.state;
		var track = state.currentTrack || {};
		var artist = track.artist || '';
		var title = track.title || '';
		var uri = String(track.uri || '');
		var cover = this.getCover(uri, item) || '';

		// show only playing zones; skip when there is nothing to show
		// (e.g. Sonos Playbar in TV mode without a title)
		if (state.playbackState !== 'PLAYING' || (!artist.trim() && !title.trim() && !cover.trim())) {
			return '';
		}

		var type = this.getType(uri, item) || '';
		var volume = item.members.length > 1 ? item.coordinator.groupState.volume : state.volume;
		var duration = track.duration || 0;

		var roomHtml = this.config.showRoomName
			? this.html.room.format(this.config.preRoomText, this.escape(room), volume)
			: '';
		var typeHtml = this.html.type.format(this.config.preTypeText, this.escape(type.charAt(0).toUpperCase() + type.slice(1)));
		var progressHtml = this.html.progression.format(
			state.elapsedTimeFormatted || '',
			this.getTrackPercent(state.elapsedTime, duration),
			this.formatDuration(duration),
			duration > 0 ? '' : 'dontShow');
		var nameHtml = this.html.name.format(
			this.config.preArtistText, this.escape(artist),
			this.config.preTrackText, this.escape(title),
			title.length > this.MAX_TITLE_LENGTH ? 'animation' : '',
			roomHtml, typeHtml, progressHtml);

		var artHtml = '';
		if (this.config.showAlbumArt) {
			artHtml = cover.indexOf('icon:') === 0
				? this.html.artIcon.format(cover.slice(5))
				: this.html.art.format(this.escape(cover));
		}
		return '<div class="song">' + nameHtml + artHtml + '</div>';
	},

	// Base URL ("http://<ip>:1400") of a speaker, from the optional
	// 'speakerUrls' config, keyed by room name or UUID.
	getSpeakerUrl: function(coordinator) {
		var urls = this.config.speakerUrls || {};
		return urls[coordinator.roomName] || urls[coordinator.uuid] || '';
	},

	getCover: function(uri, item) {
		var track = item.coordinator.state.currentTrack || {};
		if (uri.includes('bluetooth')) {
			// Font Awesome icon instead of an image (see renderZone)
			return 'icon:fa-brands fa-bluetooth';
		}
		if (uri.includes('x-sonos-htastream')) {
			return 'https://w7.pngwing.com/pngs/669/222/png-transparent-tv-illustration-computer-icons-television-computer-keyboard-tv-icon-miscellaneous-angle-text.png';
		}
		if (uri.includes('x-rincon-stream')) {
			return 'https://www.pioneerdj.com/-/media/pioneerdj/images/features/controller/ddj-flx4/ddj-flx4_hotspot_top_pc.png';
		}
		// node-sonos-http-api already resolves the full URL
		// (speaker address + path, or a high-res cover).
		if (track.absoluteAlbumArtUri) {
			return this.artSrc(track.absoluteAlbumArtUri);
		}
		var art = track.albumArtUri || '';
		if (art === '' || /^https?:\/\//.test(art)) {
			return this.artSrc(art);
		}
		// relative path: served by the speaker itself
		return this.artSrc((this.getSpeakerUrl(item.coordinator) || this.config.apiAlbumArt) + art);
	},

	// Album art through the mirror (see node_helper.js): works even when the
	// browser cannot reach the speakers or the internet. Relative URL, so it
	// also works with a basePath.
	artSrc: function(url) {
		if (!url || !this.config.proxyAlbumArt) {
			return url;
		}
		return this.name + '/albumart?url=' + encodeURIComponent(url);
	},

	// First match wins: keep the more specific patterns first.
	SOURCE_TYPES: [
		['x-sonos-htastream', 'TV'],
		['x-sonosapi-stream', 'Radio'],
		['x-sonosapi-radio', 'Radio'],
		['x-sonos-spotify', 'Spotify'],
		['x-rincon-stream', 'Line-in'],
		['bluetooth', 'Bluetooth'],
		['x-file-cifs', 'NAS'],
		['x-sonos-http:song', 'Apple Music'],
		['soundcloud', 'Soundcloud'],
		['cloudcast', 'Mixcloud'],
		['airplay', 'AirPlay']
	],

	getType: function(uri, item) {
		for (var i = 0; i < this.SOURCE_TYPES.length; i++) {
			if (uri.includes(this.SOURCE_TYPES[i][0])) {
				return this.SOURCE_TYPES[i][1];
			}
		}
		return (item.coordinator.state.currentTrack || {}).type;
	},

	getTrackPercent: function(elapsedTime, duration) {
		return duration > 0 ? (elapsedTime || 0) / duration * 100 : 0;
	},

	// seconds -> "hh:mm:ss"
	formatDuration: function(seconds) {
		return new Date(seconds * 1000).toISOString().substring(11, 19);
	},

	escape: function(text) {
		return String(text)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	},

	getScripts: function() {
		return ['String.format.js'];
	},

	getStyles: function() {
		return ['sonos.css'];
	},

	getDom: function() {
		var content;
		if (!this.loaded) {
			content = this.html.loading;
		} else if ((this.data.position || '').endsWith('left')) {
			content = '<ul class="flip">' + this.dom + '</ul>';
		} else {
			content = '<ul>' + this.dom + '</ul>';
		}
		var wrapper = document.createElement('div');
		wrapper.className = 'sonos';
		wrapper.innerHTML = content;
		return wrapper;
	}
});
