const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHmac } = require('node:crypto');
const { createAliyunUsageRoute, monthlyWindow, aliyunLimits } = require('../me.iany.js.ulanziPlugin/bridge/aliyun-usage.cjs');
const { createServer, createRoutes } = require('../me.iany.js.ulanziPlugin/bridge/server.cjs');
const { sanitize } = require('../me.iany.js.ulanziPlugin/bridge/ai-usage.cjs');
const root = path.join(__dirname, '../me.iany.js.ulanziPlugin');
const config = { aliyunInstanceId: 'spn-test', aliyunAccessKeyId: 'test-key-id', aliyunAccessKeySecret: 'test-secret+/' };
const row = {
    InstanceId: config.aliyunInstanceId, StartTime: '2026-09-26 10:00:00', RestPoolValue: '29.8716486',
    CurrentPoolValue: '5E+2', PoolValue: '5E+2', Currency: 'CNY', PrepayFee: '675.00', Utilization: '0.0'
};
const time = Date.parse('2026-10-01T00:00:00Z');
const url = new URL('http://127.0.0.1/usage/aliyun');
const response = (items = [row]) => new Response(JSON.stringify({ Success: true, Code: 'Success', Data: { Items: items } }));

test('monthly anniversaries use UTC+8 and the start day/time, including exact boundaries', () => {
    for (const [now, start, reset] of [
        ['2026-10-01T00:00:00Z', '2026-09-26T02:00:00.000Z', '2026-10-26T02:00:00.000Z'],
        ['2026-10-26T01:59:59Z', '2026-09-26T02:00:00.000Z', '2026-10-26T02:00:00.000Z'],
        ['2026-10-26T02:00:00Z', '2026-10-26T02:00:00.000Z', '2026-11-26T02:00:00.000Z'],
        ['2026-12-31T23:00:00Z', '2026-12-26T02:00:00.000Z', '2027-01-26T02:00:00.000Z'],
        ['2026-09-01T00:00:00Z', '2026-09-26T02:00:00.000Z', '2026-10-26T02:00:00.000Z']
    ]) {
        assert.deepEqual(monthlyWindow(row.StartTime, Date.parse(now)), { window_starts_at: start, resets_at: reset });
    }
    const midnight = monthlyWindow('2026-09-01 00:30:00', Date.parse('2026-09-30T17:00:00Z'));
    assert.equal(midnight.resets_at, '2026-10-31T16:30:00.000Z');
});
test('short months clamp anniversaries without drifting, including leap years', () => {
    for (const [start, now, reset] of [
        ['2027-01-31 10:00:00', '2027-02-01T00:00:00Z', '2027-02-28T02:00:00.000Z'],
        ['2027-01-31 10:00:00', '2027-02-28T02:00:00Z', '2027-03-31T02:00:00.000Z'],
        ['2028-01-31 10:00:00', '2028-02-01T00:00:00Z', '2028-02-29T02:00:00.000Z'],
        ['2028-01-31 10:00:00', '2028-03-31T02:00:00Z', '2028-04-30T02:00:00.000Z']
    ]) assert.equal(monthlyWindow(start, Date.parse(now)).resets_at, reset);
    for (const start of ['bad', '', null, '2027-02-30 10:00:00', '2026-09-26 25:00:00']) {
        assert.throws(() => monthlyWindow(start, time), /invalid_response/);
    }
});
test('balance uses RestPoolValue, not utilization/prepayment/pool, and validates data', () => {
    const limit = aliyunLimits(row, time).monthly;
    assert.equal(limit.remaining_amount, 29.8716486);
    assert.equal(limit.currency, 'CNY');
    assert.equal(limit.remaining_percent, 29.8716486 / 500 * 100);
    assert.equal(limit.resets_at, '2026-10-26T02:00:00.000Z');
    assert.equal(aliyunLimits({ ...row, RestPoolValue: '0' }, time).monthly.remaining_amount, 0);
    assert.equal(aliyunLimits({ ...row, CurrentPoolValue: undefined }, time).monthly.remaining_percent, limit.remaining_percent);
    assert.equal(aliyunLimits({ ...row, CurrentPoolValue: 'bad' }, time).monthly.remaining_percent, undefined);
    for (const value of [null, '', '  ', 'bad', undefined, Infinity]) {
        assert.throws(() => aliyunLimits({ ...row, RestPoolValue: value }, time), /invalid_response/);
    }
    assert.throws(() => aliyunLimits({ ...row, Currency: 'bad' }, time), /invalid_response/);
});
test('signs read-only RPC requests and selects only the requested instance without leaking keys', async () => {
    let calls = 0;
    const route = createAliyunUsageRoute({ now: () => time, nonce: () => 'test-nonce', fetchImpl: async (target, options) => {
        calls++;
        assert.equal(target, 'https://business.aliyuncs.com/');
        assert.equal(options.method, 'POST');
        assert.equal(options.redirect, 'error');
        const params = new URLSearchParams(options.body);
        assert.equal(params.get('Action'), 'QuerySavingsPlansInstance');
        assert.equal(params.get('Version'), '2017-12-14');
        assert.equal(params.get('InstanceId'), config.aliyunInstanceId);
        assert.equal(params.get('AccessKeyId'), config.aliyunAccessKeyId);
        assert.equal(params.get('Timestamp'), '2026-10-01T00:00:00Z');
        const signature = params.get('Signature'); params.delete('Signature');
        const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
        const canonical = [...params].sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, value]) => encode(key) + '=' + encode(value)).join('&');
        assert.equal(signature, createHmac('sha1', config.aliyunAccessKeySecret + '&').update('POST&%2F&' + encode(canonical)).digest('base64'));
        return response([{ ...row, InstanceId: 'different', RestPoolValue: '999' }, row]);
    } });
    const result = await route(url, config);
    assert.equal(calls, 1);
    assert.equal(result.providers.aliyun.accounts[0].limits.monthly.remaining_amount, 29.8716486);
    assert.equal(result.fetchedAt, time);
    assert.ok(!JSON.stringify(result).includes('test-key'));
    assert.ok(!JSON.stringify(result).includes('test-secret'));
    assert.equal(sanitize(result).providers.aliyun.accounts[0].limits.monthly.window_starts_at, '2026-09-26T02:00:00.000Z');
});
test('Aliyun cache shares matching configurations, isolates changes and throttles forced refresh', async () => {
    let calls = 0; let now = time;
    const route = createAliyunUsageRoute({ now: () => now, fetchImpl: async () => {
        calls++; await new Promise(resolve => setTimeout(resolve, 10)); return response();
    } });
    const [first, second] = await Promise.all([route(url, config), route(url, config)]);
    assert.deepEqual(first, second); assert.equal(calls, 1);
    const force = new URL(url); force.searchParams.set('refresh', '1');
    await route(force, config); assert.equal(calls, 1);
    now += 90000;
    await route(url, config); assert.equal(calls, 1);
    await route(force, config); assert.equal(calls, 2);
    await route(url, { ...config, aliyunInstanceId: 'another-instance' }); assert.equal(calls, 3);
    await route(url, { ...config, aliyunAccessKeySecret: 'changed-secret' }); assert.equal(calls, 4);
    now += 30 * 60000;
    await route(url, config); assert.equal(calls, 5);
});
test('missing configuration makes no requests and API failures expose only safe codes', async () => {
    let calls = 0;
    const route = createAliyunUsageRoute({ fetchImpl: async () => { calls++; return response(); } });
    assert.equal((await route(url, null)).providers.aliyun.error, 'auth_missing');
    assert.equal((await route(url, { ...config, aliyunInstanceId: '' })).providers.aliyun.error, 'instance_missing');
    assert.equal(calls, 0);
    for (const [fetchImpl, code] of [
        [async () => new Response(JSON.stringify({ Code: 'NotAuthorized', Message: 'private details' }), { status: 400 }), 'auth_denied'],
        [async () => new Response(JSON.stringify({ Code: 'SignatureDoesNotMatch' }), { status: 400 }), 'auth_denied'],
        [async () => new Response('', { status: 429 }), 'rate_limited'],
        [async () => new Response(JSON.stringify({ Code: 'Throttling.User' })), 'rate_limited'],
        [async () => new Response('private error', { status: 500 }), 'invalid_response'],
        [async () => new Response('{}', { status: 500 }), 'request_failed'],
        [async () => new Response('{}'), 'invalid_response'],
        [async () => response([]), 'instance_not_found'],
        [async () => response([{ ...row, RestPoolValue: '' }]), 'invalid_response'],
        [async () => { throw new Error('private error'); }, 'request_failed']
    ]) {
        const result = await createAliyunUsageRoute({ fetchImpl, now: () => time })(url, config);
        assert.equal(result.providers.aliyun.error, code);
        assert.ok(!JSON.stringify(result).includes('private'));
    }
});
test('Aliyun uses a protected POST route; credentials never enter responses', async t => {
    const aliyunRoute = createAliyunUsageRoute({ now: () => time, fetchImpl: async () => response() });
    const server = createServer({ routes: createRoutes({ aliyunRoute }) });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
    const target = 'http://127.0.0.1:' + server.address().port + '/usage/aliyun';
    const options = { method: 'POST', headers: { 'X-Ulanzi-Bridge': '1', Origin: 'null' }, body: JSON.stringify(config) };
    const result = await fetch(target, options);
    assert.equal(result.status, 200);
    const text = await result.text();
    assert.ok(!text.includes('test-key')); assert.ok(!text.includes('test-secret'));
    assert.equal((await fetch(target, { ...options, headers: {} })).status, 403);
    assert.equal((await fetch(target, { ...options, headers: { ...options.headers, Origin: 'https://evil.test' } })).status, 403);
    assert.equal((await fetch(target, { headers: options.headers })).status, 405);
});
function widgetRuntime(fetch) {
    const texts = []; const timers = new Set();
    const ctx = { fillRect() {}, drawImage() {}, fillText(text) { texts.push(text); }, measureText(text) { return { width: text.length * 8 }; } };
    const env = {
        window: { ULANZI_BRIDGE_URL: 'http://127.0.0.1:23456' }, URL, AbortController, fetch, setTimeout, clearTimeout,
        setInterval(fn) { timers.add(fn); return fn; }, clearInterval(fn) { timers.delete(fn); },
        Image: class { constructor() { this.complete = true; this.naturalWidth = 24; } },
        document: { createElement() { return { getContext: () => ctx, toDataURL: () => 'data:image/png;base64,test' }; } },
        $UD: { setBaseDataIcon() {}, openUrl() {} }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'plugin/widgets/ai-usage.js'), 'utf8'), env);
    return { Widget: env.window.AiUsageWidget, texts, timers };
}
test('Aliyun widget shares POSTs, shows balance/reset, hides secrets and isolates setting changes', async t => {
    const calls = [];
    const { Widget, texts, timers } = widgetRuntime(async (target, options) => {
        calls.push({ target, options });
        return { ok: true, json: async () => ({ providers: { aliyun: { accounts: [{ active: true, limits: aliyunLimits(row, time) }] } }, fetchedAt: Date.now() }) };
    });
    const a = new Widget('a'); const b = new Widget('b');
    t.after(() => { a.destroy(); b.destroy(); });
    a.updateSettings({ provider: 'aliyun', ...config }); b.updateSettings({ provider: 'aliyun', ...config });
    await a.source.pending;
    assert.equal(calls.length, 1); assert.equal(timers.size, 1);
    assert.equal(calls[0].target, 'http://127.0.0.1:23456/usage/aliyun');
    assert.equal(calls[0].options.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].options.body), config);
    assert.ok(!calls[0].target.includes('test-key'));
    const snapshot = a.getSnapshot();
    assert.equal(snapshot.settings.limit, 'monthly');
    assert.equal(snapshot.usage.remaining_amount, 29.8716486);
    assert.equal(snapshot.usage.resets_at, '2026-10-26T02:00:00.000Z');
    assert.ok(!JSON.stringify(snapshot).includes('test-key')); assert.ok(!JSON.stringify(snapshot).includes('test-secret'));
    assert.ok(texts.includes('¥29')); assert.ok(!texts.includes('.87'));
    const selected = Widget.selectUsage(a.source.data, a.settings);
    const dial = Widget.gauges(selected, 'monthly', Date.parse('2026-10-11T02:00:00Z'));
    assert.equal(dial.usage, 29.8716486 / 500);
    assert.equal(dial.time, 0.5);
    a.handlePress(); await a.source.pending;
    assert.equal(new URL(calls[1].target).searchParams.get('refresh'), '1');
    const old = a.source;
    a.updateSettings({ aliyunInstanceId: 'another' });
    assert.notEqual(a.source, old); assert.equal(b.source, old);
    assert.equal(a.getSnapshot().usage.error, 'Loading...');
    await a.source.pending;
    assert.equal(calls.length, 3);
    a.updateSettings({ aliyunAccessKeySecret: 'rotated' }); await a.source.pending;
    assert.equal(calls.length, 4);
    a.updateSettings({ provider: 'codex' }); await a.source.pending;
    assert.equal(calls.at(-1).options.method, undefined);
    assert.equal(calls.at(-1).options.body, undefined);
    a.destroy(); b.destroy(); assert.equal(timers.size, 0);
});
test('balance reset countdown replaces decimals, while balances without resets keep them', () => {
    const { Widget } = widgetRuntime(async () => {});
    const balance = { amount: 29.8716486, currency: 'CNY' };
    assert.equal(Widget.presentation(balance).footer, '.87');
    assert.equal(Widget.presentation({ ...balance, reset: NaN }).footer, '.87');
    for (const stale of [false, true]) {
        const display = Widget.presentation({ ...balance, reset: Date.now() + (3 * 24 + 4) * 3600000 + 30000 }, stale);
        assert.equal(display.center, '¥29');
        assert.equal(display.footer, '3d4h');
    }
    assert.equal(Widget.presentation({ ...balance, reset: Date.now() - 1000 }).footer, 'now');
});
test('Aliyun configuration and permission errors do not tell users to log in with a CLI', () => {
    const { Widget } = widgetRuntime(async () => {});
    for (const [code, message] of [['auth_missing', 'Access keys required'], ['auth_denied', 'Access denied'], ['instance_missing', 'Instance ID required'], ['instance_not_found', 'Instance not found']]) {
        assert.equal(Widget.selectUsage({ providers: { aliyun: { error: code } } }, { provider: 'aliyun' }).error, message);
    }
});
test('inspector shows Aliyun credentials only for Aliyun and coerces the monthly window', () => {
    const html = fs.readFileSync(path.join(root, 'property-inspector/ai-usage/inspector.html'), 'utf8');
    assert.match(html, /type="password" name="aliyunAccessKeySecret"/);
    const nodes = { 'aliyun-settings': {}, 'cli-hint': {} };
    const form = { elements: { provider: { value: 'aliyun' }, limit: { value: 'five_hour', options: ['five_hour', 'monthly', 'balance'].map(value => ({ value })) } } };
    const env = { document: { getElementById: id => nodes[id] }, $UD: { connect() {}, onConnected() {}, onSendToPropertyInspector() {}, onAdd() {}, onParamFromApp() {} } };
    vm.createContext(env);
    vm.runInContext(fs.readFileSync(path.join(root, 'property-inspector/ai-usage/inspector.js'), 'utf8'), env);
    env.testForm = form;
    vm.runInContext('form = testForm; updateWindows()', env);
    assert.equal(form.elements.limit.value, 'monthly');
    assert.equal(nodes['aliyun-settings'].hidden, false); assert.equal(nodes['cli-hint'].hidden, true);
    assert.ok(form.elements.limit.options.filter(option => option.value !== 'monthly').every(option => option.disabled));
    form.elements.provider.value = 'codex'; vm.runInContext('updateWindows()', env);
    assert.equal(nodes['aliyun-settings'].hidden, true); assert.equal(nodes['cli-hint'].hidden, false);
    for (const lang of ['en', 'zh_CN']) {
        const locale = JSON.parse(fs.readFileSync(path.join(root, lang + '.json'), 'utf8'));
        for (const text of ['Aliyun Savings Plan', 'Instance ID', 'Access Key ID', 'Access Key Secret']) assert.ok(locale.Localization[text]);
    }
    assert.ok(fs.existsSync(path.join(root, 'resources/ai-usage/aliyun.svg')));
});
