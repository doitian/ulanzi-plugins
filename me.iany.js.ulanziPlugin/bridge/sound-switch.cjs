// SoundSwitch route: runs SoundSwitch.CLI.exe commands; server.cjs owns HTTP.
const { execFile, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMMAND_TIMEOUT = 8000;
const EXECUTABLE_NAME = 'SoundSwitch.CLI.exe';
const MAX_PATH = 512;
const MAX_NAME = 200;
const ERROR_CODES = new Set(['cli_missing', 'invalid_path', 'timeout', 'command_failed', 'invalid_response', 'invalid_request']);

// Never surface CLI stderr, install paths, or command lines to widgets.
function safeError(error) { return ERROR_CODES.has(error && error.message) ? error.message : 'command_failed'; }

function whichSync(name, env) {
    try {
        const out = execFileSync('where.exe', [name], { encoding: 'utf8', timeout: 3000, windowsHide: true, env, stdio: ['ignore', 'pipe', 'ignore'] });
        return out.split(/\r?\n/).map(line => line.trim()).find(Boolean) || null;
    } catch (_) { return null; }
}

function scoopCandidates(env, home) {
    const roots = [];
    if (env.SCOOP) roots.push(env.SCOOP);
    const fallback = path.join(home, 'scoop');
    if (!roots.includes(fallback)) roots.push(fallback);
    return roots.map(root => path.join(root, 'apps', 'soundswitch', 'current', EXECUTABLE_NAME));
}

// Auto-detect order: PATH, then the scoop install ($env:SCOOP, then ~/scoop).
function detectExecutable({ env, exists, which, home }) {
    const onPath = which(EXECUTABLE_NAME, env);
    if (onPath) return onPath;
    for (const candidate of scoopCandidates(env, home)) {
        if (exists(candidate)) return candidate;
    }
    return null;
}

function runCli(exec, exe, args) {
    return new Promise((resolve, reject) => {
        exec(exe, args, { timeout: COMMAND_TIMEOUT, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 },
            (error, stdout) => {
                if (error) return reject(new Error(error.code === 'ENOENT' ? 'cli_missing' : error.killed ? 'timeout' : 'command_failed'));
                resolve(stdout);
            });
    });
}

function parseProfiles(payload) {
    if (!Array.isArray(payload)) throw new Error('invalid_response');
    return payload.map(row => {
        if (!row || typeof row.name !== 'string' || !row.name.trim()) throw new Error('invalid_response');
        const text = value => typeof value === 'string' ? value : '';
        return {
            name: row.name.trim(),
            playbackDevice: text(row.playbackDevice),
            playbackCommunicationDevice: text(row.playbackCommunicationDevice),
            recordingDevice: text(row.recordingDevice),
            recordingCommunicationDevice: text(row.recordingCommunicationDevice)
        };
    });
}

function parseMute(payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.isMuted !== 'boolean') throw new Error('invalid_response');
    return { isMuted: payload.isMuted, deviceName: typeof payload.deviceName === 'string' ? payload.deviceName : '' };
}

function parseStatus(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('invalid_response');
    const status = {};
    for (const field of ['activeProfile', 'playbackDevice', 'recordingDevice', 'playbackCommunicationDevice', 'recordingCommunicationDevice']) {
        status[field] = typeof payload[field] === 'string' ? payload[field] : '';
    }
    return status;
}

function parseJson(stdout) {
    try { return JSON.parse(stdout); }
    catch (_) { throw new Error('invalid_response'); }
}

function createSoundSwitchRoutes({ exec = execFile, env = process.env, exists = fs.existsSync, which = whichSync, home = os.homedir(), now = Date.now, interval = 3000 } = {}) {
    const caches = new Map(); // kind + resolved exe -> { body, readAt }
    let resolvedAuto;

    function resolve(explicit) {
        const target = typeof explicit === 'string' ? explicit.trim().slice(0, MAX_PATH) : '';
        if (target) {
            if (!exists(target)) throw new Error('invalid_path');
            return target;
        }
        if (resolvedAuto === undefined) resolvedAuto = detectExecutable({ env, exists, which, home });
        if (!resolvedAuto) throw new Error('cli_missing');
        return resolvedAuto;
    }

    async function query(kind, exe, args, parse) {
        let resolved;
        try { resolved = resolve(exe); }
        catch (error) { return { error: safeError(error) }; }
        const key = kind + '|' + resolved;
        const cache = caches.get(key);
        if (cache && now() - cache.readAt < interval) return cache.body;
        let body;
        try {
            body = Object.assign(parse(parseJson(await runCli(exec, resolved, args))), { error: null });
        } catch (error) {
            body = cache ? Object.assign({}, cache.body, { error: safeError(error) }) : { error: safeError(error) };
        }
        caches.set(key, { body, readAt: now() });
        return body;
    }

    const status = url => query('status', url.searchParams.get('exe'), ['status', '--json'], parseStatus);
    const mute = url => query('mute', url.searchParams.get('exe'), ['mute', '--json'], parseMute);
    const profiles = url => query('profiles', url.searchParams.get('exe'), ['profile', '--list', '--json'], payload => ({ profiles: parseProfiles(payload) }));

    async function run(url) {
        const params = url.searchParams;
        let exe;
        try { exe = resolve(params.get('exe')); }
        catch (error) { return { ok: false, error: safeError(error) }; }
        const command = params.get('command');
        let args;
        if (command === 'switch') {
            const type = params.get('type');
            if (type !== 'Playback' && type !== 'Recording') return { ok: false, error: 'invalid_request' };
            args = ['switch', '--type', type, '--json'];
        } else if (command === 'mute') {
            args = ['mute', '--toggle', '--json'];
        } else if (command === 'profile') {
            const name = (params.get('name') || '').slice(0, MAX_NAME);
            if (!name.trim()) return { ok: false, error: 'invalid_request' };
            args = ['profile', '--name', name, '--json'];
        } else {
            return { ok: false, error: 'invalid_request' };
        }
        try {
            await runCli(exec, exe, args);
        } catch (error) {
            return { ok: false, error: safeError(error) };
        }
        for (const key of caches.keys()) {
            if (key.endsWith('|' + exe)) caches.delete(key); // A switch invalidates the cached readings.
        }
        return { ok: true };
    }

    return { status, mute, profiles, run };
}

module.exports = { createSoundSwitchRoutes, detectExecutable, parseProfiles, parseMute, parseStatus, whichSync };
