// Ulanzi launches this Node entry point and owns this process's lifetime.
const { createServer } = require('../bridge/server.cjs');
const { loadWidgets } = require('./node-runtime.cjs');

async function main() {
    const { default: UlanziApi } = await import('../libs/node-sdk/index.js');
    const api = new UlanziApi();
    const server = createServer();
    // Start once for the whole plugin, before accepting widget events.
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const bridgeUrl = 'http://127.0.0.1:' + server.address().port;
    console.info('Widget bridge listening on ' + bridgeUrl);
    let dispose = () => {};
    let stopping = false;
    const stop = () => {
        if (stopping) return;
        stopping = true;
        dispose();
        api.websocket?.close();
        server.close();
        server.closeAllConnections();
        process.exit(0);
    };
    api.onClose(stop);
    api.onError(() => {}); // The SDK emits EventEmitter's special error event.
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    dispose = loadWidgets(api, bridgeUrl);
}
main().catch(() => { console.error('Unable to start widget plugin. Check dependencies and bridge port.'); process.exit(1); });
