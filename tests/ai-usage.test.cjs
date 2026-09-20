const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createUsageRoute, sanitize } = require('../me.iany.js.ulanziPlugin/bridge/ai-usage.cjs');
const { createServer, createRoutes } = require('../me.iany.js.ulanziPlugin/bridge/server.cjs');
const root = path.join(__dirname, '../me.iany.js.ulanziPlugin');
const fixture = { providers: {
    codex: { accounts: [
        { email: 'old@example.com', active: false, limits: { five_hour: { remaining_percent: 12 } } },
        { email: 'active@example.com', active: true, limits: {
            five_hour: { remaining_percent: 73, used_percent: 27, resets_at: '2099-01-01T00:00:00Z' },
            seven_day: { used_percent: 100 }
        } }
    ] },
    claude: { accounts: [{ active: true, limits: { seven_day_fable: { remaining_percent: 40 } } }] }
} };
function runtime(fetch = async () => ({ ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) })) {
    const timers = new Set();
    const texts = [];
    const icons = [];
    const opened = [];
    const ctx = { drawImage() {}, measureText(text) { return { width: text.length * 10 }; }, fillRect() {}, fillText(text) { texts.push(text); } };
    const env = { Image: class { constructor() { this.complete = true; this.naturalWidth = 24; } }, window: { ULANZI_BRIDGE_URL: 'http://127.0.0.1:23456' }, URL, AbortController, fetch, console,
        setTimeout, clearTimeout,
        setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); },
        document: { createElement() { return { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,test' }; } },
        $UD: { setBaseDataIcon(context) { icons.push(context); }, openUrl(url) { opened.push(url); } }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'plugin/widgets/ai-usage.js'), 'utf8'), env);
    return { Widget: env.window.AiUsageWidget, timers, texts, icons, opened };
}
test('selects active/exact account, remaining vs used, missing/error and model windows', () => {
    const select = runtime().Widget.selectUsage;
    assert.equal(select(fixture, {}).remaining, 73);
    assert.equal(select(fixture, { account: 'OLD@example.com' }).remaining, 12);
    assert.equal(select(fixture, { limit: 'seven_day' }).remaining, 0);
    assert.equal(select(fixture, { provider: 'claude', limit: 'seven_day_fable' }).remaining, 40);
    assert.equal(select({ providers: { xai: { accounts: [{ active: true, limits: { weekly: { remaining_percent: 76 } } }] } } }, { provider: 'xai', limit: 'weekly' }).remaining, 76);
    assert.ok(select(fixture, { account: 'unknown' }).error);
    assert.ok(select(fixture, { limit: 'absent' }).error);
    for (const remaining of [null, '', '50', NaN]) {
        assert.ok(select({ providers: { codex: { limits: { five_hour: { remaining_percent: remaining } } } } }, {}).error);
    }
    assert.equal(select({ providers: { codex: { limits: { five_hour: { remaining_percent: -5 } } } } }, {}).remaining, 0);
    assert.ok(select({ providers: { codex: { error: 'unauthorized' } } }, {}).error);
    assert.ok(select({ providers: { codex: { accounts: [{ active: false, limits: {} }] } } }, {}).error);
});
test('keys share fetches, retain stale readings, skip inactive renders and release polling', async () => {
    let calls = 0;
    let fail = false;
    const { Widget, timers, texts, icons } = runtime(async () => {
        calls++;
        if (fail) throw new Error('offline');
        return { ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) };
    });
    const a = new Widget('a'); const b = new Widget('b');
    a.updateSettings({}); b.updateSettings({ limit: 'seven_day' });
    await a.source.pending;
    assert.equal(calls, 1); assert.equal(timers.size, 1);
    assert.ok(texts.includes('73%')); assert.ok(texts.includes('0%'));
    b.setActive(false);
    const before = icons.filter(x => x === 'b').length;
    fail = true; await a.source.refresh(true);
    assert.ok(texts.includes('stale'));
    assert.equal(icons.filter(x => x === 'b').length, before);
    a.destroy(); assert.equal(timers.size, 1);
    b.destroy(); assert.equal(timers.size, 0);
});

test('instance snapshots select configured usage and retain stale data without fetching', async t => {
    let calls = 0;
    let fail = false;
    const { Widget } = runtime(async () => {
        calls++;
        if (fail) throw new Error('private upstream error');
        return { ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) };
    });
    const widget = new Widget('configured-key');
    t.after(() => widget.destroy());
    assert.equal(widget.getSnapshot().usage.error, 'Loading...');
    assert.equal(widget.getSnapshot().fetchedAt, null);
    widget.updateSettings({ account: 'OLD@example.com', label: 'Work', token: 'private-token' });
    await widget.source.pending;
    let snapshot = widget.getSnapshot();
    assert.equal(snapshot.context, 'configured-key');
    assert.equal(snapshot.settings.provider, 'codex');
    assert.equal(snapshot.settings.limit, 'five_hour');
    assert.equal(snapshot.settings.label, 'Work');
    assert.equal(snapshot.usage.remaining_percent, 12);
    assert.equal(snapshot.usage.resets_at, null);
    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.error, null);
    assert.ok(!JSON.stringify(snapshot).includes('private-token'));
    widget.updateSettings({ account: '', limit: 'five_hour' });
    snapshot = widget.getSnapshot();
    assert.equal(snapshot.usage.remaining_percent, 73);
    assert.equal(snapshot.usage.resets_at, '2099-01-01T00:00:00.000Z');
    widget.setActive(false);
    fail = true;
    await widget.source.refresh(true);
    snapshot = widget.getSnapshot();
    assert.equal(snapshot.active, false);
    assert.equal(snapshot.stale, true);
    assert.equal(snapshot.error, 'Helper offline');
    assert.equal(snapshot.usage.remaining_percent, 73);
    assert.equal(calls, 2);
    widget.updateSettings({ account: 'missing@example.com' });
    assert.equal(widget.getSnapshot().usage.error, 'No account');
    widget.source.error = '';
    widget.source.data = { providers: { moonshot: { limits: { balance: { remaining_amount: 123.45, currency: 'CNY' } } } }, fetchedAt: Date.now() - 36 * 60000 };
    widget.updateSettings({ provider: 'moonshot', limit: 'balance', account: '' });
    snapshot = widget.getSnapshot();
    assert.equal(snapshot.usage.remaining_amount, 123.45);
    assert.equal(snapshot.usage.currency, 'CNY');
    assert.equal(snapshot.stale, true);
});
test('press opens provider defaults or an override, including while offline', () => {
    const { Widget, opened } = runtime();
    const widget = new Widget('key');
    for (const [provider, expected] of Object.entries({
        claude: 'https://claude.ai/new#settings/usage', codex: 'https://chatgpt.com/#settings/Usage',
        'opencode-go': 'https://opencode.ai/go', moonshot: 'https://platform.kimi.com/console/account',
        'moonshot-cn': 'https://platform.kimi.com/console/account', 'kimi-code': 'https://www.kimi.com/code/console', xai: 'https://grok.com/?_s=usage'
    })) {
        widget.settings = { provider };
        widget.handlePress(); assert.equal(opened.at(-1), expected);
    }
    widget.settings = { provider: 'opencode-go', url: '  https://opencode.ai/workspace/example/go  ' };
    widget.handlePress(); assert.equal(opened.at(-1), 'https://opencode.ai/workspace/example/go');
    widget.settings.url = '  ';
    widget.handlePress(); assert.equal(opened.at(-1), 'https://opencode.ai/go');
    const count = opened.length;
    widget.destroy(); widget.handlePress(); assert.equal(opened.length, count);
});
test('saved helper URLs cannot override the runtime endpoint', async () => {
    const urls = [];
    const { Widget } = runtime(async url => {
        urls.push(url);
        return { ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) };
    });
    const a = new Widget('a');
    a.updateSettings({ helperUrl: 'http://example.com/usage' }); await a.source.pending;
    assert.equal(urls[0], 'http://127.0.0.1:23456/usage');
    assert.equal(a.settings.helperUrl, undefined);
    a.destroy();
});
test('press opens the page and forces a shared refresh, including offline recovery', async () => {
    const urls = [];
    const { Widget, opened, texts } = runtime(async url => {
        urls.push(url);
        if (urls.length === 1) throw new Error('offline');
        return { ok: true, json: async () => ({ ...fixture, fetchedAt: Date.now() }) };
    });
    const a = new Widget('a'); const b = new Widget('b');
    a.updateSettings({}); b.updateSettings({ limit: 'seven_day' });
    await a.source.pending;
    a.handlePress(); b.handlePress();
    assert.equal(opened.length, 2);
    await a.source.pending;
    assert.equal(urls.length, 2);
    assert.equal(new URL(urls[1]).searchParams.get('refresh'), '1');
    assert.ok(texts.includes('73%')); assert.ok(texts.includes('0%'));
    a.destroy(); b.destroy();
    a.handlePress(); assert.equal(urls.length, 2); assert.equal(opened.length, 2);
});
test('helper caches, coalesces requests, rate-limits retries and validates browser access', async t => {
    let calls = 0; let time = 100000; let fail = false;
    const usageRoute = createUsageRoute({ now: () => time, run: async () => {
        calls++; await new Promise(resolve => setTimeout(resolve, 10));
        if (fail) throw new Error('secret upstream response');
        return fixture;
    } });
    const server = createServer({ routes: new Map([['/usage', usageRoute]]) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const url = 'http://127.0.0.1:' + server.address().port + '/usage';
    const get = (suffix = '') => fetch(url + suffix, { headers: { 'X-Ulanzi-Usage': '1', Origin: 'null' } });
    const responses = await Promise.all([get(), get()]);
    assert.equal(calls, 1);
    assert.equal((await responses[0].json()).providers.codex.accounts[1].limits.five_hour.remaining_percent, 73);
    assert.equal((await get('?refresh=1')).status, 200); assert.equal(calls, 1);
    time += 90000; await get('?refresh=1'); assert.equal(calls, 2);
    time += 1800001; fail = true;
    const failed = await get(); assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('secret'));
    await get(); assert.equal(calls, 3);
    time += 90000; fail = false; assert.equal((await get()).status, 200);
    assert.equal((await fetch(url)).status, 403);
    assert.equal((await fetch(url, { headers: { Origin: 'https://evil.example', 'X-Ulanzi-Usage': '1' } })).status, 403);
    const badHostStatus = await new Promise((resolve, reject) => {
        require('node:http').get(url, { headers: { Host: 'evil.example', 'X-Ulanzi-Usage': '1' } }, response => {
            response.resume(); resolve(response.statusCode);
        }).on('error', reject);
    });
    assert.equal(badHostStatus, 403);
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: 'null' } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'null');
});
test('refresh endpoint shares the usage cache, throttle and in-flight requests', async t => {
    let calls = 0; let time = 100000; let fail = false;
    const usageRoute = createUsageRoute({ now: () => time, run: async () => {
        calls++;
        await new Promise(resolve => setTimeout(resolve, 20));
        if (fail) throw new Error('private upstream details');
        return fixture;
    } });
    const server = createServer({ routes: createRoutes({ usageRoute }) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = 'http://127.0.0.1:' + server.address().port;
    const headers = { 'X-Ulanzi-Bridge': '1', Origin: 'null' };
    const read = () => fetch(base + '/usage', { headers });
    const refresh = () => fetch(base + '/usage/refresh', { method: 'POST', headers });
    const initial = await (await read()).json();
    assert.equal(calls, 1);
    assert.deepEqual(await (await refresh()).json(), initial);
    assert.equal(calls, 1);
    time += 90000;
    assert.deepEqual(await (await read()).json(), initial);
    const responses = await Promise.all([refresh(), refresh()]);
    assert.equal(calls, 2);
    const updated = await responses[0].json();
    assert.equal(updated.fetchedAt, time);
    assert.deepEqual(await responses[1].json(), updated);
    assert.deepEqual(await (await read()).json(), updated);
    assert.equal(calls, 2);

    const endpoint = base + '/usage/refresh';
    assert.equal((await fetch(endpoint, { method: 'POST' })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { 'X-Ulanzi-Usage': '1' } })).status, 403);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status, 403);
    const wrongMethod = await fetch(endpoint, { headers });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'POST, OPTIONS');
    const preflight = await fetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'null' } });
    assert.equal(preflight.status, 204);
    assert.ok(preflight.headers.get('access-control-allow-methods').includes('POST'));
    assert.equal(calls, 2);

    time += 90000; fail = true;
    const failed = await refresh();
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes('private'));
    assert.equal((await refresh()).status, 503);
    assert.equal(calls, 3);
    time += 90000; fail = false;
    assert.equal((await refresh()).status, 200);
    assert.equal(calls, 4);
});

test('helper excludes secrets and isolates provider errors', () => {
    const output = sanitize({ providers: { codex: fixture.providers.codex, claude: { error: 'secret token' } }, token: 'secret' });
    assert.ok(!JSON.stringify(output).includes('secret'));
    assert.equal(output.providers.codex.accounts[1].limits.five_hour.remaining_percent, 73);
    assert.ok(output.providers.claude.error);
});
test('different widget routes share one server and failures stay isolated', async t => {
    const server = createServer({ routes: new Map([
        ['/usage', createUsageRoute({ run: async () => fixture })],
        ['/system-stats', async url => ({ sample: url.searchParams.get('sample'), cpu: 42 })],
        ['/broken', async () => { throw new Error('private details'); }]
    ]) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const base = 'http://127.0.0.1:' + server.address().port;
    const get = route => fetch(base + route, { headers: { 'X-Ulanzi-Bridge': '1', Origin: 'null' } });
    const [usage, stats] = await Promise.all([get('/usage'), get('/system-stats?sample=latest')]);
    assert.ok((await usage.json()).providers.codex);
    assert.deepEqual(await stats.json(), { sample: 'latest', cpu: 42 });
    assert.equal((await get('/unknown')).status, 404);
    const broken = await get('/broken');
    assert.equal(broken.status, 503); assert.ok(!(await broken.text()).includes('private'));
    assert.equal((await get('/system-stats')).status, 200);
    assert.equal((await fetch(base + '/system-stats', { headers: { 'X-Ulanzi-Usage': '1' } })).status, 403);
    assert.equal((await fetch(base + '/system-stats', { method: 'POST', headers: { 'X-Ulanzi-Bridge': '1' } })).status, 405);
});
test('manifest assets, scripts and localization entries are complete', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    for (const action of manifest.Actions) {
        for (const file of [action.Icon, action.PropertyInspectorPath, ...action.States.map(s => s.Image)]) {
            assert.ok(fs.existsSync(path.join(root, file)), file);
        }
    }
    for (const lang of ['en', 'zh_CN']) {
        const locale = JSON.parse(fs.readFileSync(path.join(root, lang + '.json')));
        assert.equal(locale.Actions.length, manifest.Actions.length);
    }
    const app = fs.readFileSync(path.join(root, 'plugin/app.html'), 'utf8');
    assert.ok(app.indexOf('widgets/ai-usage.js') < app.indexOf('./app.js'));
});
test('reference percentage thresholds, balance split and balance thresholds', () => {
    const { Widget } = runtime();
    for (const [remaining, color] of [[0, '#e63c32'], [29.9, '#e63c32'], [30, '#f0be00'], [59.9, '#f0be00'], [60, '#00c850'], [100, '#00c850']]) {
        assert.equal(Widget.presentation({ remaining }, false).color, color);
    }
    assert.equal(Widget.presentation({ error: 'No limit data' }).color, '#a0a0a0');
    assert.equal(Widget.presentation({ error: 'Rate limited' }).center, '429');
    for (const [amount, currency, center, footer, color] of [
        [123.45, 'CNY', '¥123', '.45', '#00c850'], [12345.67, 'CNY', '¥12K', '.345', '#00c850'],
        [70, 'CNY', '¥70', '.00', '#00c850'], [36, 'CNY', '¥36', '.00', '#f0be00'],
        [35.99, 'CNY', '¥35', '.99', '#e63c32'], [12, 'USD', '$12', '.00', '#00c850'],
        [6, 'USD', '$6', '.00', '#f0be00'], [-1, 'USD', '$0', '.00', '#e63c32']
    ]) {
        const display = Widget.presentation({ amount, currency }, false);
        assert.equal(display.center, center); assert.equal(display.footer, footer); assert.equal(display.color, color);
    }
    const data = sanitize({ providers: { moonshot: { accounts: [{ active: true, limits: { balance: { remaining_amount: 123.45, currency: 'CNY' } } }] } } });
    assert.equal(Widget.selectUsage(data, { provider: 'moonshot', limit: 'balance' }).amount, 123.45);
});
