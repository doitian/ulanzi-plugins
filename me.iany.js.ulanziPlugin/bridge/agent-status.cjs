// Agent status route: agent-berth session counts only; server.cjs owns HTTP.
const { execFile } = require('node:child_process');

const COMMAND_TIMEOUT = 5000;
const FORCE_INTERVAL = 500;
const STATUSES = ['waiting', 'running', 'done', 'idle'];
const PROVIDER_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;

function parseStats(payload) {
    if (!Array.isArray(payload)) throw new Error('invalid_response');
    const providers = {};
    for (const row of payload) {
        if (!row || typeof row !== 'object') throw new Error('invalid_response');
        const provider = typeof row.provider === 'string' ? row.provider.trim().toLowerCase() : '';
        if (!PROVIDER_NAME.test(provider)) throw new Error('invalid_response');
        const counts = providers[provider] || (providers[provider] = { waiting: 0, running: 0, done: 0, idle: 0 });
        for (const status of STATUSES) {
            const value = row[status];
            if (!Number.isInteger(value) || value < 0) throw new Error('invalid_response');
            counts[status] += value; // agent-berth may report a provider across several rows.
        }
    }
    return providers;
}

function readStats() {
    const command = process.env.ULANZI_AGENT_BERTH || 'agent-berth';
    return new Promise((resolve, reject) => {
        execFile(command, ['stats', '--json'], { timeout: COMMAND_TIMEOUT, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 },
            (error, stdout) => {
                if (error) return reject(new Error(error.code === 'ENOENT' ? 'agent_berth_missing' : error.killed ? 'timeout' : 'command_failed'));
                try { resolve(JSON.parse(stdout)); }
                catch (_) { reject(new Error('invalid_response')); }
            });
    });
}

const ERROR_CODES = new Set(['agent_berth_missing', 'timeout', 'command_failed', 'invalid_response']);
// Never surface agent-berth stderr, session paths, or command lines to widgets.
function safeError(error) { return ERROR_CODES.has(error && error.message) ? error.message : 'command_failed'; }

function createAgentsRoute({ run = readStats, now = Date.now, interval = 1500 } = {}) {
    let cache = null;
    let pending = null;
    function read(force) {
        if (pending) return pending;
        if (cache && now() - cache.readAt < (force ? FORCE_INTERVAL : interval)) return Promise.resolve(cache.body);
        pending = Promise.resolve().then(async () => {
            let body;
            try {
                body = { providers: parseStats(await run()), fetchedAt: now(), error: null };
            } catch (error) {
                // Keep the last counts so a transient failure does not blank the keys.
                body = { providers: cache?.body.providers || {}, fetchedAt: cache?.body.fetchedAt ?? null, error: safeError(error) };
            }
            cache = { body, readAt: now() };
            pending = null;
            return body;
        });
        return pending;
    }
    return async function agentsRoute(url, force = false) {
        return read(force || url.searchParams.get('refresh') === '1');
    };
}

module.exports = { createAgentsRoute, parseStats, readStats };
