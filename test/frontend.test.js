const test = require('node:test');
const assert = require('node:assert/strict');
const { loadFrontend, zone } = require('./load');

test('formatDuration: short form under an hour', () => {
	const mod = loadFrontend();
	assert.equal(mod.formatDuration(0), '0:00');
	assert.equal(mod.formatDuration(225), '3:45');
	assert.equal(mod.formatDuration(3725), '1:02:05');
	assert.equal(mod.formatDuration(undefined), '0:00');
});

test('getType: known sources, bluetooth before line-in, fallback capitalized', () => {
	const mod = loadFrontend();
	assert.equal(mod.getType('x-sonos-spotify:abc', {}), 'Spotify');
	assert.equal(mod.getType('x-sonos-htastream:RINCON_1:spdif', {}), 'TV');
	assert.equal(mod.getType('x-rincon-stream:RINCON_1', {}), 'Line-in');
	assert.equal(mod.getType('x-rincon-stream:RINCON_1?bluetooth', {}), 'Bluetooth');
	assert.equal(mod.getType('x-unknown:1', { type: 'track' }), 'Track');
	assert.equal(mod.getType('x-unknown:1', {}), '');
});

test('getCover: album art, relative path, source icons and sourceArt', () => {
	const mod = loadFrontend({ proxyAlbumArt: false, speakerUrls: { 'Living Room': 'http://192.168.1.20:1400' } });
	assert.equal(mod.getCover(zone(), 'Spotify'), 'https://i.scdn.co/image/abc');

	const relative = zone({ track: { absoluteAlbumArtUri: '', albumArtUri: '/getaa?u=1' } });
	assert.equal(mod.getCover(relative, 'Spotify'), 'http://192.168.1.20:1400/getaa?u=1');

	assert.equal(mod.getCover(zone(), 'TV'), 'fa-solid fa-tv');

	const custom = loadFrontend({ proxyAlbumArt: false, sourceArt: { 'Line-in': 'https://example.com/dj.png', TV: 'fa-solid fa-film' } });
	assert.equal(custom.getCover(zone(), 'Line-in'), 'https://example.com/dj.png');
	assert.equal(custom.getCover(zone(), 'TV'), 'fa-solid fa-film');
});

test('getCover: album art goes through the mirror proxy by default', () => {
	const mod = loadFrontend({ sourceArt: { 'Line-in': 'https://example.com/dj.png', TV: 'fa-solid fa-film' } });
	assert.equal(mod.getCover(zone(), 'Spotify'), `MMM-Sonos/albumart?url=${encodeURIComponent('https://i.scdn.co/image/abc')}`);
	assert.equal(mod.getCover(zone(), 'Line-in'), `MMM-Sonos/albumart?url=${encodeURIComponent('https://example.com/dj.png')}`);
	assert.equal(mod.getCover(zone(), 'TV'), 'fa-solid fa-film');
});

test('update: sends API settings and the addresses the proxy may use', () => {
	const mod = loadFrontend({
		speakerUrls: { 'Living Room': 'http://192.168.1.20:1400' },
		sourceArt: { 'Line-in': 'https://example.com/dj.png', TV: 'fa-solid fa-film' }
	});
	let payload;
	mod.sendSocketNotification = (n, p) => { payload = p; };
	mod.update();
	assert.equal(payload.useEvents, true);
	assert.deepEqual(payload.artOrigins, ['http://192.168.1.20:1400', 'https://example.com/dj.png', 'http://localhost']);
});

test('getRoomName: excluded rooms are removed', () => {
	const mod = loadFrontend({ exclude: ['Kitchen'] });
	const item = zone({ members: [{ roomName: 'Living Room' }, { roomName: 'Kitchen' }] });
	assert.equal(mod.getRoomName(item), 'Living Room');
	assert.equal(mod.getRoomName(zone({ members: [{ roomName: 'Kitchen' }] })), '');
});

test('render: only playing zones, hides when nothing plays', () => {
	const mod = loadFrontend();
	mod.render([zone({ state: { playbackState: 'PAUSED_PLAYBACK' } })]);
	assert.equal(mod.hidden, true);
	assert.equal(mod.dom, '');

	mod.render([zone()]);
	assert.equal(mod.hidden, false);
	assert.match(mod.dom, /One More Time/);
});

test('render: titles and artists are escaped', () => {
	const mod = loadFrontend();
	mod.render([zone({ track: { title: '<b>x</b>', artist: 'A & B' } })]);
	assert.match(mod.dom, /&lt;b&gt;x&lt;\/b&gt;/);
	assert.match(mod.dom, /A &amp; B/);
});

test('render: long titles get the scrolling classes', () => {
	const mod = loadFrontend();
	mod.render([zone({ track: { title: 'A very very long title that must scroll' } })]);
	assert.match(mod.dom, /title-wrapper scrolling/);
	assert.match(mod.dom, /class="title animation"/);
});

test('render: mute icon for muted speaker, muted group or volume 0', () => {
	const mod = loadFrontend();
	mod.render([zone()]);
	assert.match(mod.dom, /fa-volume-high/);
	mod.render([zone({ state: { mute: true } })]);
	assert.match(mod.dom, /fa-volume-xmark/);
	mod.render([zone({ state: { volume: 0 } })]);
	assert.match(mod.dom, /fa-volume-xmark/);
	const group = [{ roomName: 'Living Room' }, { roomName: 'Kitchen' }];
	mod.render([zone({ members: group, groupState: { mute: true } })]);
	assert.match(mod.dom, /fa-volume-xmark/);
});

test('render: fade only when the song changes, not for progress', () => {
	const mod = loadFrontend();
	mod.render([zone()], 1000);
	mod.render([zone({ state: { elapsedTime: 90 } })], 2000);
	mod.render([zone({ track: { title: 'Aerodynamic' } })], 3000);
	assert.deepEqual(mod.updates, [1000, 0, 1000]);
});

test('progress clock: runs on when the API repeats the same elapsed time', () => {
	const mod = loadFrontend();
	mod.render([zone({ state: { elapsedTime: 60 } })], 0);
	// same value 30 s later: the API did not refresh it, keep counting
	mod.render([zone({ state: { elapsedTime: 60 } })], 30000);
	assert.match(mod.dom, /class="elapsed">1:30</);
	// new value from the API: trust it
	mod.render([zone({ state: { elapsedTime: 120 } })], 31000);
	assert.match(mod.dom, /class="elapsed">2:00</);
});

test('progress clock: never goes past the song duration', () => {
	const mod = loadFrontend();
	mod.render([zone({ state: { elapsedTime: 300 } })], 0);
	mod.render([zone({ state: { elapsedTime: 300 } })], 60000);
	assert.match(mod.dom, /class="elapsed">5:20</);
});

test('progress clock: a paused zone starts fresh', () => {
	const mod = loadFrontend();
	mod.render([zone({ state: { elapsedTime: 60 } })], 0);
	mod.render([zone({ state: { playbackState: 'PAUSED_PLAYBACK' } })], 10000);
	mod.render([zone({ state: { elapsedTime: 60 } })], 50000);
	assert.match(mod.dom, /class="elapsed">1:00</);
});
