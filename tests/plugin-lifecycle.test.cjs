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
            ULANZI_GROK_CREDENTIALS: path.join(__dirname, 'missing-auth.json'),
            MOONSHOT_API_KEY: '', MOONSHOT_CN_API_KEY: '', OPENCODE_GO_API_KEY: '',
            ULANZI_AGENT_BERTH: path.join(__dirname, 'missing-agent-berth')
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
            for (const action of ['aiUsage', 'clashTraffic', 'agentStatus']) socket.send(JSON.stringify({
                cmd: 'add', uuid: 'me.iany.ulanzistudio.js.' + action, key: action, actionid: 'test',
                // Stale URL must be ignored; synthetic credential paths isolate the real accounts.
                param: { helperUrl: 'http://127.0.0.1:1/usage', wsUrl: 'ws://127.0.0.1:1/traffic' }
            }));
        }
        for (const state of message.param?.statelist || []) {
            if (state.type === 1) assert.ok(state.data.startsWith('data:image/png;base64,'));
            rendered.add(state.key);
            if (rendered.size === 3) resolve(socket);
        }
    })));
    const socket = await Promise.race([icons, exited.then(code => { throw new Error('Plugin exited before rendering: ' + code); })]);
    const bridgePort = await allocatedPort;
    assert.notEqual(bridgePort, occupiedPort);
    const health = await fetch('http://127.0.0.1:' + bridgePort + '/health', { headers: { 'X-Ulanzi-Bridge': '1' } });
    assert.equal((await health.json()).service, 'me.iany.ulanzistudio.js.bridge');
    const instancesUrl = 'http://127.0.0.1:' + bridgePort + '/usage/fetch';
    const readInstances = async () => {
        const response = await fetch(instancesUrl, { headers: { 'X-Ulanzi-Bridge': '1' } });
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type'), /application\/json/);
        return (await response.json()).instances;
    };
    const waitForInstances = async predicate => {
        for (let attempt = 0; attempt < 100; attempt++) {
            const instances = await readInstances();
            if (predicate(instances)) return instances;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.fail('Instance state did not match Ulanzi events');
    };
    const initial = await waitForInstances(rows => rows.length === 1 && rows[0].fetchedAt !== null);
    assert.equal(initial[0].settings.provider, 'codex');
    assert.equal(initial[0].settings.limit, 'five_hour');
    assert.equal(initial[0].usage.error, 'CLI login required');
    assert.equal(initial[0].active, true);
    assert.equal((await fetch(instancesUrl)).status, 403);
    assert.equal((await fetch('http://127.0.0.1:' + bridgePort + '/instances', { headers: { 'X-Ulanzi-Bridge': '1' } })).status, 404);
    assert.equal((await fetch(instancesUrl, { headers: { 'X-Ulanzi-Usage': '1' } })).status, 403);
    assert.equal((await fetch(instancesUrl, { headers: { 'X-Ulanzi-Bridge': '1', Origin: 'https://example.com' } })).status, 403);
    const second = { uuid: 'me.iany.ulanzistudio.js.aiUsage', key: 'second', actionid: 'test' };
    const secondContext = second.uuid + '___second___test';
    socket.send(JSON.stringify({ cmd: 'add', ...second, param: { provider: 'claude', limit: 'seven_day', label: 'Weekly' } }));
    const added = await waitForInstances(rows => rows.length === 2);
    assert.equal(added.find(row => row.context === secondContext).settings.provider, 'claude');
    socket.send(JSON.stringify({ cmd: 'paramfromapp', ...second, param: { provider: 'xai', limit: 'monthly' } }));
    socket.send(JSON.stringify({ cmd: 'setactive', ...second, active: false }));
    const updated = await waitForInstances(rows => rows.some(row => row.context === secondContext && !row.active && row.settings.provider === 'xai'));
    assert.equal(updated.find(row => row.context === secondContext).settings.limit, 'monthly');
    socket.send(JSON.stringify({ cmd: 'clear', param: [second] }));
    const cleared = await waitForInstances(rows => rows.length === 1);
    assert.equal(cleared[0].context, initial[0].context);
    socket.send(JSON.stringify({ cmd: 'clear', param: [{ uuid: 'me.iany.ulanzistudio.js.aiUsage', key: 'aiUsage', actionid: 'test' }] }));
    await waitForInstances(rows => rows.length === 0);
    socket.close();
    assert.equal(await exited, 0);
    await assert.rejects(fetch('http://127.0.0.1:' + bridgePort + '/health'));
});
