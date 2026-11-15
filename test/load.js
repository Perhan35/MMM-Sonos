// Loads the module files outside MagicMirror, with small fakes for the
// globals MagicMirror normally provides.
const Module = require('node:module');
const path = require('node:path');

const root = path.join(__dirname, '..');

function loadFrontend(config = {}) {
	let definition;
	global.Module = { register: (name, def) => { definition = def; } };
	global.Log = { info() {} };
	const file = path.join(root, 'MMM-Sonos.js');
	delete require.cache[file];
	require(file);
	const mod = Object.create(definition);
	mod.name = 'MMM-Sonos';
	mod.config = { ...definition.defaults, ...config };
	mod.clocks = {};
	mod.updates = [];
	mod.updateDom = (speed) => mod.updates.push(speed);
	mod.hide = () => { mod.hidden = true; };
	mod.show = () => { mod.hidden = false; };
	return mod;
}

function loadHelper() {
	const load = Module._load;
	Module._load = function (request, ...rest) {
		if (request === 'node_helper') {
			return { create: (def) => def };
		}
		return load.call(this, request, ...rest);
	};
	try {
		const file = path.join(root, 'node_helper.js');
		delete require.cache[file];
		const definition = require(file);
		const helper = Object.create(definition);
		helper.name = 'MMM-Sonos';
		helper.sent = [];
		helper.sendSocketNotification = (n, payload) => helper.sent.push([n, payload]);
		helper.expressApp = { post() {}, get() {} };
		helper.start();
		return helper;
	} finally {
		Module._load = load;
	}
}

// A zone as node-sonos-http-api returns it (only the fields we use).
function zone(overrides = {}) {
	const track = {
		uri: 'x-sonos-spotify:spotify%3atrack%3a123',
		type: 'track',
		artist: 'Daft Punk',
		title: 'One More Time',
		duration: 320,
		absoluteAlbumArtUri: 'https://i.scdn.co/image/abc',
		...overrides.track
	};
	return {
		members: overrides.members || [{ roomName: 'Living Room' }],
		coordinator: {
			uuid: 'RINCON_1',
			roomName: 'Living Room',
			groupState: { volume: 20, mute: false, ...overrides.groupState },
			state: {
				playbackState: 'PLAYING',
				volume: 25,
				mute: false,
				elapsedTime: 60,
				...overrides.state,
				currentTrack: track
			}
		}
	};
}

module.exports = { loadFrontend, loadHelper, zone };
