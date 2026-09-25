// Shared local HTTP server for all widget types. Run: node bridge/server.cjs
const http = require('node:http');
const { createUsageRoute } = require('./ai-usage.cjs');
const { createAgentsRoute } = require('./agent-status.cjs');
const { createSoundSwitchRoutes } = require('./sound-switch.cjs');

function createRoutes({ getInstances = () => [], usageRoute = createUsageRoute(), agentsRoute = createAgentsRoute(), soundSwitch = createSoundSwitchRoutes() } = {}) {
    return new Map([
        ['/health', async () => ({ service: 'me.iany.ulanzistudio.js.bridge' })],
        ['/usage/fetch', () => ({ instances: getInstances() })],
        ['/usage', usageRoute],
        ['/usage/refresh', url => usageRoute(url, true)],
        ['/agents', agentsRoute],
        ['/sound-switch/status', soundSwitch.status],
        ['/sound-switch/mute', soundSwitch.mute],
        ['/sound-switch/profiles', soundSwitch.profiles],
        ['/sound-switch/aliases', soundSwitch.aliases],
        ['/sound-switch/aliases/save', soundSwitch.setAliases],
        ['/sound-switch/run', soundSwitch.run]
        // Register other widget route factories here, on the same server.
    ]);
}

const POST_PATHS = new Set(['/usage/refresh', '/sound-switch/aliases/save', '/sound-switch/run']);

function readBody(req, limit = 1 << 20) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.setEncoding('utf8');
        req.on('data', chunk => {
            data += chunk;
            if (data.length > limit) { reject(new Error('too_large')); req.destroy(); }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

function createServer({ routes = createRoutes() } = {}) {
    return http.createServer(async (req, res) => {
        const port = res.socket.localPort;
        const origin = req.headers.origin;
        // HTML plugins have opaque file origins. Block remote origins/Host names.
        if (req.headers.host !== '127.0.0.1:' + port ||
            (origin && origin !== 'null' && origin !== 'http://127.0.0.1:' + port)) {
            res.writeHead(403).end(); return;
        }
        res.setHeader('Access-Control-Allow-Origin', origin || 'null');
        res.setHeader('Access-Control-Allow-Headers', 'X-Ulanzi-Bridge, X-Ulanzi-Usage');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); }
        catch (_) { res.writeHead(400).end(); return; }
        const method = POST_PATHS.has(url.pathname) ? 'POST' : 'GET';
        if (req.method !== method) { res.setHeader('Allow', method + ', OPTIONS'); res.writeHead(405).end(); return; }
        const legacyUsage = url.pathname === '/usage' && req.headers['x-ulanzi-usage'] === '1';
        if (req.headers['x-ulanzi-bridge'] !== '1' && !legacyUsage) {
            res.writeHead(403).end(); return;
        }
        const handler = routes.get(url.pathname);
        if (!handler) { res.writeHead(404).end(); return; }
        let body = null;
        if (req.method === 'POST') {
            try {
                const raw = await readBody(req);
                body = raw ? JSON.parse(raw) : null;
            } catch (_) {
                res.writeHead(400).end(JSON.stringify({ error: 'invalid_request' }));
                return;
            }
        }
        res.setHeader('Content-Type', 'application/json');
        try { res.end(JSON.stringify(await handler(url, body))); }
        catch (_) { res.writeHead(503).end(JSON.stringify({ error: 'Widget data unavailable. Check the local helper.' })); }
    });
}

if (require.main === module) {
    const port = Number(process.env.ULANZI_BRIDGE_PORT || process.env.ULANZI_USAGE_PORT || 18765);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid widget bridge port');
    const server = createServer();
    server.on('error', error => { console.error('Widget server:', error.message); process.exitCode = 1; });
    server.listen(port, '127.0.0.1', () => console.log('Widget server listening on http://127.0.0.1:' + port));
}
module.exports = { createServer, createRoutes };
