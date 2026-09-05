const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { WebSocketServer } = require('../me.iany.js.ulanziPlugin/node_modules/ws');

test('Ulanzi launch starts the bridge, renders widgets, and exits with the host', async t => {
    const portProbe = net.createServer();
    await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    const occupiedPort = portProbe.address().port;
    t.after(() => portProbe.close());
    const host = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise(resolve => host.once('listening', resolve));
    const child = spawn(process.execPath, [path.resolve('me.iany.js.ulanziPlugin/plugin/main.js'), '127.0.0.1', String(host.address().port), 'en'], {
        env: { ...process.env, ULANZI_BRIDGE_PORT: String(occupiedPort),
            ULANZI_CODEX_CREDENTIALS: path.join(__dirname, 'missing-auth.json'),
            ULANZI_CLAUDE_CREDENTIALS: path.join(__dirname, 'missing-auth.json'),
            ULANZI_OPENCODE_AUTH: path.join(__dirname, 'missing-auth.json'),
            MOONSHOT_API_KEY: '', MOONSHOT_CN_API_KEY: '', OPENCODE_GO_API_KEY: ''
        }, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    });
    t.after(() => { child.kill(); for (const client of host.clients) client.terminate(); host.close(); });
    const allocatedPort = new Promise(resolve => {
        let output = '';
        child.stdout.on('data', chunk => {
            output += chunk;
            const match = output.match(/Widget bridge listening on http:\/\/127\.0\.0\.1:(\d+)/);
            if (match) resolve(Number(match[1]));
        });
    });
    const exited = new Promise(resolve => child.once('exit', (code) => resolve(code)));
    const timeout = setTimeout(() => child.kill(), 10000);
    t.after(() => clearTimeout(timeout));
    const rendered = new Set();
    const icons = new Promise(resolve => host.on('connection', socket => socket.on('message', raw => {
        const message = JSON.parse(raw);
        if (message.cmd === 'connected') {
            for (const action of ['aiUsage', 'clashTraffic']) socket.send(JSON.stringify({
                cmd: 'add', uuid: 'me.iany.ulanzistudio.js.' + action, key: action, actionid: 'test',
                // Stale URL must be ignored; synthetic credential paths isolate the real accounts.
                param: { helperUrl: 'http://127.0.0.1:1/usage', wsUrl: 'ws://127.0.0.1:1/traffic' }
            }));
        }
        for (const state of message.param?.statelist || []) {
            if (state.type === 1) assert.ok(state.data.startsWith('data:image/png;base64,'));
            rendered.add(state.key);
            if (rendered.size === 2) resolve(socket);
        }
    })));
    const socket = await Promise.race([icons, exited.then(code => { throw new Error('Plugin exited before rendering: ' + code); })]);
    const bridgePort = await allocatedPort;
    assert.notEqual(bridgePort, occupiedPort);
    const health = await fetch('http://127.0.0.1:' + bridgePort + '/health', { headers: { 'X-Ulanzi-Bridge': '1' } });
    assert.equal((await health.json()).service, 'me.iany.ulanzistudio.js.bridge');
    socket.close();
    assert.equal(await exited, 0);
    await assert.rejects(fetch('http://127.0.0.1:' + bridgePort + '/health'));
});
