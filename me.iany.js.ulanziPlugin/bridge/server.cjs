// Shared local HTTP server for all widget types. Run: node bridge/server.cjs
const http = require('node:http');
const { createUsageRoute } = require('./ai-usage.cjs');

function createRoutes() {
    return new Map([
        ['/health', async () => ({ service: 'me.iany.ulanzistudio.js.bridge' })],
        ['/usage', createUsageRoute()]
        // Register other widget route factories here, on the same server.
    ]);
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
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Private-Network', 'true');
        res.setHeader('Cache-Control', 'no-store');
        if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }
        if (req.method !== 'GET') { res.writeHead(405).end(); return; }
        let url;
        try { url = new URL(req.url, 'http://127.0.0.1'); }
        catch (_) { res.writeHead(400).end(); return; }
        const legacyUsage = url.pathname === '/usage' && req.headers['x-ulanzi-usage'] === '1';
        if (req.headers['x-ulanzi-bridge'] !== '1' && !legacyUsage) {
            res.writeHead(403).end(); return;
        }
        const handler = routes.get(url.pathname);
        if (!handler) { res.writeHead(404).end(); return; }
        res.setHeader('Content-Type', 'application/json');
        try { res.end(JSON.stringify(await handler(url))); }
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
