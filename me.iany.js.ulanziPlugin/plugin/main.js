// Ulanzi launches this Node entry point and owns this process's lifetime.
const { installUncaughtGuard } = require('./uncaught-errors.cjs');
const { createServiceLog } = require('./service-log.cjs');

const log = createServiceLog();
installUncaughtGuard({ log });

const { createServer, createRoutes } = require('../bridge/server.cjs');
const { loadWidgets } = require('./node-runtime.cjs');

const PLUGIN_UUID = require('../manifest.json').UUID;
// The host passes `host port lang` as argv; capture them before the SDK splices argv on connect.
const HOST_ADDRESS = process.argv[2] || '127.0.0.1';
const HOST_PORT = Number(process.argv[3]) || 3906;
// A dropped host socket must not kill the service: the host does not relaunch
// a dead plugin process, so exiting leaves every key dead until the whole
// Studio restarts. Reconnect with backoff; give up only when the host stays
// unreachable (Studio quit) or keeps closing fresh connections (a replacement
// process took over).
const RECONNECT_WINDOW = Number(process.env.ULANZI_RECONNECT_GIVEUP_MS) || 10 * 60 * 1000;
const FAST_CLOSE_LIMIT = 3;
const FAST_CLOSE_MS = 30000;

async function main() {
    const { default: UlanziApi } = await import('../libs/node-sdk/index.js');
    const api = new UlanziApi();
    let runtime;
    const server = createServer({ routes: createRoutes({ getInstances: () => runtime ? runtime.getInstances() : [] }) });
    // Start once for the whole plugin, before accepting widget events.
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const bridgeUrl = 'http://127.0.0.1:' + server.address().port;
    console.info('Widget bridge listening on ' + bridgeUrl);
    log('start', 'pid ' + process.pid);
    let stopping = false;
    let reconnectTimer = null;
    const stop = reason => {
        if (stopping) return;
        stopping = true;
        log('stop', reason);
        if (reconnectTimer) clearTimeout(reconnectTimer);
        runtime?.dispose();
        api.websocket?.close();
        server.close();
        server.closeAllConnections();
        process.exit(0);
    };
    let reconnectDelay = 1000;
    let disconnectedAt = 0;
    let connectedAt = 0;
    let fastCloses = 0;
    api.onConnected(() => {
        connectedAt = Date.now();
        disconnectedAt = 0;
        reconnectDelay = 1000;
        log('connected');
    });
    api.onClose(() => {
        if (stopping) return;
        log('close');
        if (connectedAt) {
            fastCloses = Date.now() - connectedAt < FAST_CLOSE_MS ? fastCloses + 1 : 0;
            connectedAt = 0;
        }
        if (fastCloses >= FAST_CLOSE_LIMIT) return stop('replaced');
        if (!disconnectedAt) disconnectedAt = Date.now();
        if (Date.now() - disconnectedAt >= RECONNECT_WINDOW) return stop('host-unreachable');
        if (reconnectTimer) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            log('reconnect');
            api.connect(PLUGIN_UUID, HOST_PORT, HOST_ADDRESS);
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    });
    api.onError(() => {}); // The SDK emits EventEmitter's special error event.
    process.once('SIGINT', () => stop('sigint'));
    process.once('SIGTERM', () => stop('sigterm'));
    runtime = loadWidgets(api, bridgeUrl);
}
main().catch(error => {
    log('start-failed', error && (error.stack || error.message || error));
    console.error('Unable to start widget plugin. Check dependencies and bridge port.');
    process.exit(1);
});
