const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createSoundSwitchRoutes, detectExecutable, parseProfiles, parseMute, parseStatus } = require('../me.iany.js.ulanziPlugin/bridge/sound-switch.cjs');
const root = path.join(__dirname, '../me.iany.js.ulanziPlugin');

const STATUS = { activeProfile: 'Gaming', playbackDevice: 'Speakers (Realtek(R) Audio)', recordingDevice: 'Microphone (USB)', playbackCommunicationDevice: '', recordingCommunicationDevice: '' };
const PROFILES = [{ name: 'Gaming', playbackDevice: 'Speakers', playbackCommunicationDevice: '', recordingDevice: 'Mic', recordingCommunicationDevice: '' }];

function execStub(log, result) {
    return (exe, args, options, callback) => {
        log.push({ exe, args });
        const out = typeof result === 'function' ? result(exe, args) : result;
        if (out instanceof Error) return callback(out);
        callback(null, JSON.stringify(out));
    };
}

function makeRoutes({ log = [], result = STATUS, exists = () => true, which = () => null, home = 'C:\\home' } = {}) {
    let clock = 10_000;
    const tick = ms => { clock += ms; };
    const created = createSoundSwitchRoutes({
        exec: execStub(log, result), env: {}, exists, which, home,
        now: () => clock, interval: 3000
    });
    return { routes: created, tick };
}

test('detectExecutable prefers PATH, then $env:SCOOP, then ~/scoop', () => {
    const home = 'C:\\Users\\me';
    const scoop = path.join('D:\\scoop', 'apps', 'soundswitch', 'current', 'SoundSwitch.CLI.exe');
    const fallback = path.join(home, 'scoop', 'apps', 'soundswitch', 'current', 'SoundSwitch.CLI.exe');
    assert.equal(detectExecutable({ env: {}, exists: () => false, which: () => 'C:\\bin\\SoundSwitch.CLI.exe', home }), 'C:\\bin\\SoundSwitch.CLI.exe');
    assert.equal(detectExecutable({ env: { SCOOP: 'D:\\scoop' }, exists: p => p === scoop, which: () => null, home }), scoop);
    assert.equal(detectExecutable({ env: {}, exists: p => p === fallback, which: () => null, home }), fallback);
    assert.equal(detectExecutable({ env: { SCOOP: 'D:\\scoop' }, exists: () => false, which: () => null, home }), null);
});

test('parsers validate CLI output', () => {
    assert.deepEqual(parseProfiles(PROFILES), PROFILES);
    assert.throws(() => parseProfiles({}), /invalid_response/);
    assert.throws(() => parseProfiles([{ name: '  ' }]), /invalid_response/);
    assert.throws(() => parseProfiles([{ playbackDevice: 'x' }]), /invalid_response/);
    assert.deepEqual(parseMute({ deviceName: 'Mic', isMuted: true }), { isMuted: true, deviceName: 'Mic' });
    assert.deepEqual(parseMute({ isMuted: false }), { isMuted: false, deviceName: '' });
    assert.throws(() => parseMute({ isMuted: 'yes' }), /invalid_response/);
    assert.throws(() => parseMute(null), /invalid_response/);
    assert.deepEqual(parseStatus({ playbackDevice: 'A', extra: 1 }), {
        activeProfile: '', playbackDevice: 'A', recordingDevice: '', playbackCommunicationDevice: '', recordingCommunicationDevice: ''
    });
    assert.throws(() => parseStatus('x'), /invalid_response/);
});

test('queries resolve the executable, cache within the interval and keep the last reading on failure', async () => {
    const log = [];
    let current = STATUS;
    const { routes, tick } = makeRoutes({ log, result: () => current, exists: p => !p.includes('nope'), which: () => 'C:\\bin\\SoundSwitch.CLI.exe' });
    const url = new URL('http://127.0.0.1/sound-switch/status');
    const first = await routes.status(url);
    assert.equal(first.playbackDevice, STATUS.playbackDevice);
    assert.equal(first.error, null);
    assert.deepEqual(log[0], { exe: 'C:\\bin\\SoundSwitch.CLI.exe', args: ['status', '--json'] });
    tick(1000);
    await routes.status(url);
    assert.equal(log.length, 1);
    tick(3000);
    current = Object.assign(new Error('boom'), { code: 1 });
    const failed = await routes.status(url);
    assert.equal(failed.error, 'command_failed');
    assert.equal(failed.playbackDevice, STATUS.playbackDevice); // Last reading survives.
    assert.ok(!JSON.stringify(failed).includes('boom'));
    const missing = createSoundSwitchRoutes({ exec: execStub([], {}), env: {}, exists: () => false, which: () => null, home: 'none' });
    assert.equal((await missing.status(url)).error, 'cli_missing');
    assert.equal((await routes.status(new URL('http://127.0.0.1/sound-switch/status?exe=' + encodeURIComponent('C:\\nope.exe')))).error, 'invalid_path');
    const profiles = await routes.profiles(new URL('http://127.0.0.1/sound-switch/profiles'));
    assert.equal(profiles.error, 'command_failed'); // status-shaped body is not a profile list.
});

test('run maps commands to CLI arguments, validates input and invalidates caches', async () => {
    const log = [];
    const { routes } = makeRoutes({ log, exists: p => !p.includes('nope'), which: () => 'C:\\bin\\SoundSwitch.CLI.exe' });
    const base = 'http://127.0.0.1/sound-switch/run';
    await routes.status(new URL('http://127.0.0.1/sound-switch/status'));
    assert.equal(log.length, 1);
    assert.deepEqual(await routes.run(new URL(base + '?command=switch&type=Playback')), { ok: true });
    assert.deepEqual(log[1].args, ['switch', '--type', 'Playback', '--json']);
    assert.deepEqual(await routes.run(new URL(base + '?command=mute')), { ok: true });
    assert.deepEqual(log[2].args, ['mute', '--toggle', '--json']);
    assert.deepEqual(await routes.run(new URL(base + '?command=profile&name=' + encodeURIComponent('Gaming'))), { ok: true });
    assert.deepEqual(log[3].args, ['profile', '--name', 'Gaming', '--json']);
    await routes.status(new URL('http://127.0.0.1/sound-switch/status'));
    assert.equal(log.length, 5); // The switch dropped the cached status.
    assert.equal((await routes.run(new URL(base + '?command=switch&type=Speakers'))).error, 'invalid_request');
    assert.equal((await routes.run(new URL(base + '?command=profile&name='))).error, 'invalid_request');
    assert.equal((await routes.run(new URL(base + '?command=settings'))).error, 'invalid_request');
    assert.equal((await routes.run(new URL(base + '?command=mute&exe=' + encodeURIComponent('C:\\nope.exe')))).error, 'invalid_path');
    assert.equal(log.length, 5); // Rejected runs never spawn the CLI.
});

function runtime(fetch) {
    const timers = new Set();
    const texts = [];
    const images = [];
    const strokes = [];
    const fills = [];
    const ctx = {
        drawImage() {}, fillRect() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
        measureText(text) { return { width: String(text).length * 10 }; },
        fillText(text) { texts.push(String(text)); },
        stroke() { strokes.push(ctx.strokeStyle); },
        fill() { fills.push(ctx.fillStyle); }
    };
    const env = {
        Image: class { constructor() { this.complete = true; this.naturalWidth = 24; } set src(value) { images.push(value); } },
        window: { ULANZI_BRIDGE_URL: 'http://127.0.0.1:23456' }, URL, AbortController, fetch, console,
        setTimeout, clearTimeout,
        setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); },
        document: { createElement() { return { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,test' }; } },
        $UD: { setBaseDataIcon() {} }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'plugin/widgets/sound-switch.js'), 'utf8'), env);
    return { env, timers, texts, images, strokes, fills };
}

function fetchStub(requests, bodies = {}) {
    return async (url, options = {}) => {
        requests.push({ url, method: options.method || 'GET' });
        let body = { error: 'cli_missing' };
        if (url.includes('/sound-switch/status')) body = Object.assign({ error: null }, STATUS, bodies.status);
        if (url.includes('/sound-switch/mute')) body = Object.assign({ isMuted: false, deviceName: 'Mic', error: null }, bodies.mute);
        if (url.includes('/sound-switch/run')) body = bodies.run || { ok: true };
        return { ok: true, json: async () => body };
    };
}

test('playback key labels the active device, presses switch and refreshes', async () => {
    const requests = [];
    const { env, texts, images, timers } = runtime(fetchStub(requests, { status: { playbackDevice: '扬声器' } }));
    const widget = new env.window.SoundSwitchPlaybackWidget('pb');
    widget.updateSettings({});
    await widget.source.pending;
    assert.ok(texts.includes('扬声器')); // CJK device names render via the YaHei font stack.
    assert.deepEqual(images, ['../resources/sound-switch/playback.png']);
    await widget.handlePress();
    const run = requests.find(r => r.method === 'POST');
    assert.ok(run.url.includes('/sound-switch/run?command=switch&type=Playback'));
    assert.equal(timers.size, 1);
    widget.destroy();
    assert.equal(timers.size, 0);
});

test('long device names are ellipsized and a custom label prefixes the device', async () => {
    const requests = [];
    const { env, texts } = runtime(fetchStub(requests));
    const widget = new env.window.SoundSwitchPlaybackWidget('pb');
    widget.updateSettings({ label: 'OUT' });
    await widget.source.pending;
    assert.ok(texts.some(text => text.startsWith('OUT Speakers') && text.endsWith('…')));
    widget.destroy();
});

test('mute key shows LIVE or MUTED with the device name and a red state dot when muted', async () => {
    const requests = [];
    const { env, texts, fills } = runtime(fetchStub(requests, { mute: { isMuted: true, deviceName: 'Mic' } }));
    const widget = new env.window.SoundSwitchMuteWidget('mic');
    widget.updateSettings({});
    await widget.source.pending;
    assert.ok(texts.includes('MUTED Mic'));
    assert.ok(fills.includes('#e63c32'));
    await widget.handlePress();
    assert.ok(requests.find(r => r.method === 'POST').url.includes('command=mute'));
    widget.destroy();
});

test('profile key shows the profile, an active check mark and the chosen icon', async () => {
    const requests = [];
    const { env, texts, images, strokes } = runtime(fetchStub(requests));
    const widget = new env.window.SoundSwitchProfileWidget('prof');
    widget.updateSettings({ profile: 'Gaming' });
    await widget.source.pending;
    assert.ok(texts.includes('Gaming'));
    assert.ok(strokes.includes('#85c995')); // Active profile gets a green check.
    assert.deepEqual(images, ['../resources/sound-switch/profile.svg']);
    await widget.handlePress();
    assert.ok(requests.find(r => r.method === 'POST').url.includes('command=profile&name=Gaming'));
    widget.updateSettings({ profile: 'Gaming', icon: 'playback' });
    assert.ok(images.includes('../resources/sound-switch/playback.png'));
    widget.updateSettings({ profile: 'Gaming', icon: 'bogus' });
    assert.equal(images.filter(src => src.includes('bogus')).length, 0);
    assert.equal(images[images.length - 1], '../resources/sound-switch/profile.svg');
    const empty = new env.window.SoundSwitchProfileWidget('none');
    empty.updateSettings({ profile: '' });
    assert.equal(await empty.handlePress(), undefined); // No profile configured: never runs.
    widget.destroy();
    empty.destroy();
});

test('missing CLI shows NO CLI instead of a device name', async () => {
    const requests = [];
    const { env, texts } = runtime(async (url) => {
        requests.push({ url, method: 'GET' });
        return { ok: true, json: async () => ({ error: 'cli_missing' }) };
    });
    const widget = new env.window.SoundSwitchPlaybackWidget('pb');
    widget.updateSettings({});
    await widget.source.pending;
    assert.ok(texts.includes('NO CLI'));
    widget.destroy();
});
