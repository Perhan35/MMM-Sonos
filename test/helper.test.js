const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { loadHelper, zone } = require('./load');

test('readEvents: data lines count, heartbeats do not, partial line kept', () => {
	const helper = loadHelper();
	assert.deepEqual(helper.readEvents(':\n\n'), { rest: '', changed: false });
	assert.deepEqual(helper.readEvents('data: {"type":"x"}\n\nda'), { rest: 'da', changed: true });
	assert.deepEqual(helper.readEvents('data: {"type"'), { rest: 'data: {"type"', changed: false });
});

test('slimZones: keeps only what the frontend uses', () => {
	const helper = loadHelper();
	const raw = zone();
	raw.coordinator.state.nextTrack = { title: 'not needed' };
	const slim = helper.slimZones([raw]);
	assert.equal(slim[0].coordinator.state.currentTrack.title, 'One More Time');
	assert.equal(slim[0].coordinator.state.mute, false);
	assert.equal(slim[0].coordinator.groupState.mute, false);
	assert.equal(slim[0].coordinator.state.nextTrack, undefined);
	assert.deepEqual(helper.slimZones(null), []);
});

test('album art proxy: only API-given URLs, speakers and config addresses', () => {
	const helper = loadHelper();
	helper.socketNotificationReceived = () => {}; // no network here
	helper.configOrigins.add('http://192.168.1.21:1400');
	helper.rememberArt([zone({ track: { absoluteAlbumArtUri: 'http://192.168.1.20:1400/getaa?u=1', albumArtUri: 'https://i.scdn.co/image/abc' } })]);
	assert.equal(helper.isAllowedArt('https://i.scdn.co/image/abc'), true);
	assert.equal(helper.isAllowedArt('https://i.scdn.co/image/other'), false);
	assert.equal(helper.isAllowedArt('http://192.168.1.20:1400/getaa?u=2'), true);
	assert.equal(helper.isAllowedArt('http://192.168.1.21:1400/anything'), true);
	assert.equal(helper.isAllowedArt('http://169.254.169.254/latest'), false);
	assert.equal(helper.isAllowedArt('file:///etc/passwd'), false);
});

test('send: only real changes, unless forced', () => {
	const helper = loadHelper();
	helper.send([1]);
	helper.send([1]);
	helper.forceSend = true;
	helper.send([1]);
	assert.equal(helper.sent.length, 2);
});

// A fake node-sonos-http-api: /zones answers, /events streams.
function fakeApi(t, { zones = () => [zone()], events } = {}) {
	const server = http.createServer((req, res) => {
		if (req.url === '/zones') {
			res.setHeader('Content-Type', 'application/json');
			res.end(JSON.stringify(zones()));
		} else if (req.url === '/events' && events) {
			res.writeHead(200, { 'Content-Type': 'text/event-stream' });
			events(res);
		} else {
			res.statusCode = 404;
			res.end();
		}
	});
	t.after(() => {
		server.closeAllConnections();
		server.close();
	});
	return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function until(check, timeout = 3000) {
	const startedAt = Date.now();
	return new Promise((resolve, reject) => {
		const poll = () => {
			if (check()) {
				resolve();
			} else if (Date.now() - startedAt > timeout) {
				reject(new Error('timed out'));
			} else {
				setTimeout(poll, 20);
			}
		};
		poll();
	});
}

function startHelper(t, port, useEvents) {
	const helper = loadHelper();
	t.after(() => helper.stop());
	helper.socketNotificationReceived('SONOS_UPDATE', {
		apiBase: 'http://127.0.0.1', apiPort: port, apiEndpoint: 'zones', useEvents
	});
	return helper;
}

test('events: a data line split over two writes refreshes the zones', async (t) => {
	let title = 'One More Time';
	let stream;
	const server = await fakeApi(t, {
		zones: () => [zone({ track: { title } })],
		events: (res) => { stream = res; }
	});
	const helper = startHelper(t, server.address().port, true);
	await until(() => stream && helper.sent.length === 1);

	title = 'Aerodynamic';
	stream.write(': heartbeat\n\n');
	stream.write('data: {"type":"transport-st');
	stream.write('ate"}\n\n');
	await until(() => helper.sent.length === 2);
	assert.equal(helper.sent[1][1][0].coordinator.state.currentTrack.title, 'Aerodynamic');
});

test('events: reconnects when the stream closes', async (t) => {
	let connections = 0;
	let stream;
	const server = await fakeApi(t, {
		events: (res) => { connections++; stream = res; }
	});
	startHelper(t, server.address().port, true);
	await until(() => connections === 1);
	stream.end();
	await until(() => connections === 2);
});

test('zones: hides the song after the API fails several times', async (t) => {
	let up = true;
	const server = await fakeApi(t, { zones: () => (up ? [zone()] : null) });
	const helper = startHelper(t, server.address().port, false);
	await until(() => helper.sent.length === 1);

	up = false;
	server.closeAllConnections();
	server.close();
	for (let i = 0; i < 3; i++) {
		helper.fetchZones(false);
		await until(() => !helper.fetching);
	}
	assert.equal(helper.sent.length, 2);
	assert.deepEqual(helper.sent[1][1], []);
});
