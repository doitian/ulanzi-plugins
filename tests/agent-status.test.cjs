const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createAgentsRoute, parseStats, readStats } = require('../me.iany.js.ulanziPlugin/bridge/agent-status.cjs');
const root = path.join(__dirname, '../me.iany.js.ulanziPlugin');
// Widget values come from a vm context, so compare them as plain data.
const plain = value => JSON.parse(JSON.stringify(value));
const stats = [
    { provider: 'claude', waiting: 2, running: 2, done: 0, idle: 3, total: 7 },
    { provider: 'codex', waiting: 0, running: 1, done: 4, idle: 0, total: 5 }
];
const fixture = { providers: { claude: { waiting: 2, running: 2, done: 0, idle: 3 }, codex: { waiting: 0, running: 1, done: 4, idle: 0 } }, fetchedAt: Date.now(), error: null };

function runtime(fetch = async () => ({ ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) })) {
    const timers = new Set();
    const texts = [];
    const icons = [];
    const opened = [];
    const ctx = { drawImage() {}, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, fill() {}, stroke() {},
        measureText(text) { return { width: text.length * 10 }; }, fillText(text) { texts.push(text); } };
    const env = { Image: class { constructor() { this.complete = true; this.naturalWidth = 24; } }, window: { ULANZI_BRIDGE_URL: 'http://127.0.0.1:23456' }, URL, AbortController, fetch, console,
        setTimeout, clearTimeout,
        setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); },
        document: { createElement() { return { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,test' }; } },
        $UD: { setBaseDataIcon(context) { icons.push(context); }, openUrl(url) { opened.push(url); } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'plugin/widgets/agent-status.js'), 'utf8'), env);
    return { Widget: env.window.AgentStatusWidget, timers, texts, icons, opened };
}

test('parses agent-berth stats, merges repeated providers and rejects malformed rows', () => {
    assert.deepEqual(parseStats(stats), fixture.providers);
    assert.deepEqual(parseStats([]), {});
    assert.deepEqual(parseStats([
        { provider: 'Claude', waiting: 1, running: 0, done: 0, idle: 0 },
        { provider: 'claude', waiting: 2, running: 0, done: 0, idle: 1 }
    ]), { claude: { waiting: 3, running: 0, done: 0, idle: 1 } });
    for (const payload of [{}, 'x', [null], [{ provider: '', waiting: 0, running: 0, done: 0, idle: 0 }],
        [{ provider: 'a b', waiting: 0, running: 0, done: 0, idle: 0 }],
        [{ provider: 'claude', waiting: -1, running: 0, done: 0, idle: 0 }],
        [{ provider: 'claude', waiting: 1.5, running: 0, done: 0, idle: 0 }],
        [{ provider: 'claude', waiting: '1', running: 0, done: 0, idle: 0 }],
        [{ provider: 'claude', running: 0, done: 0, idle: 0 }]]) {
        assert.throws(() => parseStats(payload), /invalid_response/);
    }
});

test('route caches within the interval, honors refresh and reports failures without leaking detail', async () => {
    let calls = 0;
    let result = () => stats;
    let clock = 10_000;
    const route = createAgentsRoute({ run: async () => { calls++; return result(); }, now: () => clock, interval: 1500 });
    const url = new URL('http://127.0.0.1/agents');
    assert.deepEqual((await route(url)).providers, fixture.providers);
    clock += 1000;
    await route(url);
    assert.equal(calls, 1);
    assert.equal((await route(url, true)).error, null);
    assert.equal(calls, 2);
    clock += 100; // Forced reads are throttled too, so a press storm cannot spawn processes.
    await route(url, true);
    assert.equal(calls, 2);
    clock += 2000;
    result = () => { throw new Error('agent-berth stats: C:\\Users\\me\\secret-session'); };
    const failed = await route(url);
    assert.equal(failed.error, 'command_failed');
    assert.deepEqual(failed.providers, fixture.providers); // Last counts survive a failure.
    assert.equal(failed.fetchedAt, 11_000);
    clock += 2000;
    result = () => { const error = new Error('agent_berth_missing'); throw error; };
    assert.equal((await route(url)).error, 'agent_berth_missing');
    clock += 2000;
    result = () => stats;
    assert.equal((await route(url)).error, null);
    const parallel = await Promise.all([route(new URL('http://127.0.0.1/agents?refresh=1')), route(url, true)]);
    assert.equal(parallel[0], parallel[1]); // Concurrent reads share one command.
});

test('missing agent-berth reports a distinct code instead of a raw spawn error', async () => {
    const previous = process.env.ULANZI_AGENT_BERTH;
    process.env.ULANZI_AGENT_BERTH = path.join(__dirname, 'no-such-agent-berth');
    try { await assert.rejects(readStats(), /agent_berth_missing/); }
    finally { if (previous === undefined) delete process.env.ULANZI_AGENT_BERTH; else process.env.ULANZI_AGENT_BERTH = previous; }
});

test('summarizes one agent or all agents by status priority', () => {
    const { Widget } = runtime();
    assert.deepEqual(plain(Widget.summarize(fixture.providers, 'all')), {
        status: 'waiting', count: 2, counts: { waiting: 2, running: 3, done: 4, idle: 3 }
    });
    assert.deepEqual(plain(Widget.summarize(fixture.providers, 'codex')), {
        status: 'running', count: 1, counts: { waiting: 0, running: 1, done: 4, idle: 0 }
    });
    assert.equal(Widget.summarize(fixture.providers, 'pi').status, 'idle');
    assert.equal(Widget.summarize(fixture.providers, 'pi').count, 0);
    assert.equal(Widget.summarize({ claude: { done: 2 } }, 'all').status, 'done');
    assert.equal(Widget.summarize({ claude: null, grok: { idle: 'x' } }, 'all').count, 0);
    const { presentation } = Widget;
    assert.equal(presentation({ status: 'waiting', count: 2, counts: {} }, false).color, '#f2a65a');
    assert.equal(presentation({ status: 'waiting', count: 2, counts: {} }, false).footer, '');
    assert.equal(presentation({ status: 'waiting', count: 2, counts: {} }, true).color, '#a0a0a0');
    assert.equal(presentation({ error: 'agent_berth_missing' }).center, 'n/a');
    assert.equal(presentation({ error: 'nonsense' }).center, 'Err');
});

test('keys share one poll, show the selected agent, retain counts when the helper fails and release polling', async () => {
    let calls = 0;
    let fail = false;
    const { Widget, timers, texts, icons, opened } = runtime(async () => {
        calls++;
        if (fail) throw new Error('offline');
        return { ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) };
    });
    const all = new Widget('all');
    const codex = new Widget('codex');
    all.updateSettings({});
    codex.updateSettings({ agent: 'codex', label: 'CX', url: 'https://example.com/agents' });
    await all.source.pending;
    assert.equal(calls, 1);
    assert.equal(timers.size, 1);
    assert.ok(texts.includes('AGENTS'));
    assert.ok(texts.includes('2')); // All agents: two claude sessions are waiting.
    assert.ok(texts.includes('CX'));
    assert.ok(texts.includes('1')); // Codex alone: one running session.
    assert.ok(!texts.includes('WAITING')); // The glyph replaces the status caption.
    codex.setActive(false);
    const before = icons.filter(context => context === 'codex').length;
    fail = true;
    await all.source.refresh(true);
    assert.ok(texts.includes('stale'));
    assert.equal(icons.filter(context => context === 'codex').length, before);
    codex.setActive(true);
    codex.handlePress();
    assert.deepEqual(opened, ['https://example.com/agents']);
    all.handlePress();
    assert.equal(opened.length, 1); // No press URL configured: refresh only.
    all.destroy();
    assert.equal(timers.size, 1);
    codex.destroy();
    assert.equal(timers.size, 0);
});

test('reports agent-berth failures before any reading arrives', async () => {
    const { Widget, texts } = runtime(async () => ({ ok: true, json: async () => ({ providers: {}, fetchedAt: null, error: 'agent_berth_missing' }) }));
    const widget = new Widget('one');
    widget.updateSettings({});
    assert.ok(texts.includes('...'));
    await widget.source.pending;
    assert.ok(texts.includes('n/a'));
    assert.ok(texts.includes('NO CLI'));
    widget.destroy();
});
