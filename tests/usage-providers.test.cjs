const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createUsageClient, claudeLimits, codexLimits, grokLimits, kimiCodeLimits } = require('../me.iany.js.ulanziPlugin/bridge/usage-providers.cjs');
const time = 1900000000000;
const jwt = claims => 'header.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.signature';
const codexUsage = { rate_limit: {
    primary_window: { limit_window_seconds: 604800, used_percent: 45, reset_at: time / 1000 + 86400 },
    secondary_window: { limit_window_seconds: 18000, used_percent: 12, reset_at: time / 1000 + 3600 }
} };
const claudeUsage = { five_hour: { utilization: 27, resets_at: '2030-03-18T12:00:00Z' }, limits: [
    { kind: 'weekly_scoped', percent: 65, resets_at: '2030-03-18T12:00:00Z', scope: { model: { display_name: 'Fable' } } }
] };
async function setup(t) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ulanzi-usage-test-'));
    t.after(async () => {
        assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
        assert.ok(path.basename(dir).startsWith('ulanzi-usage-test-'));
        for (const name of await fs.readdir(dir)) await fs.unlink(path.join(dir, name));
        await fs.rmdir(dir);
    });
    const claudeFile = path.join(dir, 'claude.json'); const codexFile = path.join(dir, 'codex.json');
    const claude = { other: { keep: true }, claudeAiOauth: { accessToken: 'claude-access', refreshToken: 'claude-refresh', expiresAt: time + 3600000, scopes: ['keep'] } };
    const codex = { other: { keep: true }, tokens: { access_token: jwt({ exp: time / 1000 + 3600 }), refresh_token: 'codex-refresh', id_token: jwt({ email: 'active@example.com' }), account_id: 'test-account' } };
    await fs.writeFile(claudeFile, JSON.stringify(claude)); await fs.writeFile(codexFile, JSON.stringify(codex));
    return { claude, codex, claudeFile, codexFile, options: {
        home: dir, env: { ULANZI_CLAUDE_CREDENTIALS: claudeFile, ULANZI_CODEX_CREDENTIALS: codexFile }, now: () => time
    } };
}
const json = data => new Response(JSON.stringify(data), { status: 200 });
test('OpenCode credentials provide Go windows and independent Moonshot China balance', async t => {
    const data = await setup(t);
    const authFile = path.join(path.dirname(data.codexFile), 'opencode.json');
    data.options.env.ULANZI_OPENCODE_AUTH = authFile;
    await fs.writeFile(authFile, JSON.stringify({
        'opencode-go': { type: 'api', key: 'go-key' },
        moonshotai: { type: 'api', key: 'international-key' },
        'moonshotai-cn': { type: 'api', key: 'china-key' }
    }));
    const client = createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url === 'https://opencode.ai/zen/go/v1/usage') {
            assert.equal(options.headers.Authorization, 'Bearer go-key');
            return json({ usage: {
                rolling: { percent: 25, resetsAt: '2030-03-18T12:00:00Z' },
                weekly: { percent: 80, resetsAt: '2030-03-20T12:00:00Z' },
                monthly: { percent: 0, resetsAt: '2030-04-01T00:00:00Z' }
            } });
        }
        if (url.includes('moonshot.')) {
            assert.equal(options.headers.Authorization, url.includes('.cn/') ? 'Bearer china-key' : 'Bearer international-key');
            return json({ code: 0, data: { available_balance: url.includes('.cn/') ? 123.45 : 12.34 } });
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } });
    const result = await client();
    const limits = result.providers['opencode-go'].accounts[0].limits;
    assert.equal(limits.rolling.remaining_percent, 75);
    assert.equal(limits.weekly.remaining_percent, 20);
    assert.equal(limits.monthly.remaining_percent, 100);
    assert.equal(result.providers['moonshot-cn'].accounts[0].limits.balance.currency, 'CNY');
    assert.equal(result.providers.moonshot.accounts[0].limits.balance.currency, 'USD');
    assert.ok(!JSON.stringify(result).includes('-key'));
});
test('Go environment override, malformed windows and China credential isolation', async t => {
    const data = await setup(t);
    data.options.env.OPENCODE_GO_API_KEY = 'override-go';
    data.options.env.MOONSHOT_API_KEY = 'international-only';
    const urls = [];
    const client = createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        urls.push(url);
        if (url.includes('opencode.ai')) {
            assert.equal(options.headers.Authorization, 'Bearer override-go');
            return json({ usage: { rolling: { percent: null, resetsAt: '2030-01-01' } } });
        }
        if (url.includes('moonshot.ai')) return json({ code: 0, data: { available_balance: 10 } });
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } });
    const result = await client();
    assert.equal(result.providers['opencode-go'].error, 'invalid_response');
    assert.equal(result.providers['moonshot-cn'].error, 'auth_missing');
    assert.ok(!urls.some(url => url.includes('moonshot.cn')));
    assert.ok(result.providers.codex.accounts);
});
test('Moonshot balance uses the correct endpoint and currency', async t => {
    const data = await setup(t);
    data.options.env.MOONSHOT_API_KEY = 'synthetic-key';
    data.options.env.MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
    const client = createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url.includes('moonshot.cn')) {
            assert.equal(url, 'https://api.moonshot.cn/v1/users/me/balance');
            assert.equal(options.headers.Authorization, 'Bearer synthetic-key');
            return json({ code: 0, data: { available_balance: 123.45 } });
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } });
    const result = await client();
    assert.deepEqual(result.providers.moonshot.accounts[0].limits.balance, { remaining_amount: 123.45, currency: 'CNY' });
    assert.ok(!JSON.stringify(result).includes('synthetic-key'));
});
test('Grok weekly remaining uses CLI tokens, treats missing percent as unused, and refreshes', async t => {
    const data = await setup(t);
    const grokFile = path.join(path.dirname(data.codexFile), 'grok.json');
    data.options.env.ULANZI_GROK_CREDENTIALS = grokFile;
    const session = { other: { keep: true }, key: 'grok-access', refresh_token: 'grok-refresh', oidc_client_id: 'grok-client', email: 'grok@example.com', expires_at: new Date(time + 3600000).toISOString() };
    await fs.writeFile(grokFile, JSON.stringify({ 'https://auth.x.ai::grok-client': session }));
    const grokUsage = { config: { creditUsagePercent: 24, currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2030-03-18T12:00:00Z' } } };
    const client = createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url.includes('cli-chat-proxy.grok.com')) {
            assert.equal(options.headers.Authorization, 'Bearer grok-access');
            return json(grokUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } });
    const result = await client();
    assert.equal(result.providers.xai.accounts[0].limits.weekly.remaining_percent, 76);
    assert.equal(result.providers.xai.accounts[0].email, 'grok@example.com');
    assert.equal(grokLimits({ config: { currentPeriod: { type: 'USAGE_PERIOD_TYPE_WEEKLY', end: '2030-03-18T12:00:00Z' } } }).weekly.remaining_percent, 100);
    assert.deepEqual(grokLimits({ config: {} }), {});
    session.key = jwt({ exp: time / 1000 - 1 });
    session.expires_at = new Date(time - 1).toISOString();
    await fs.writeFile(grokFile, JSON.stringify({ 'https://auth.x.ai::grok-client': session, extra: { keep: true } }));
    let refreshes = 0;
    const rotated = await createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url.endsWith('/oauth2/token')) {
            refreshes++;
            const form = new URLSearchParams(options.body);
            assert.equal(form.get('grant_type'), 'refresh_token');
            assert.equal(form.get('client_id'), 'grok-client');
            return json({ access_token: 'rotated-grok', refresh_token: 'rotated-grok-refresh', expires_in: 3600 });
        }
        if (url.includes('cli-chat-proxy.grok.com')) {
            assert.equal(options.headers.Authorization, 'Bearer rotated-grok');
            return json(grokUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } })();
    assert.equal(refreshes, 1);
    assert.ok(rotated.providers.xai.accounts);
    const stored = JSON.parse(await fs.readFile(grokFile, 'utf8'));
    assert.equal(stored['https://auth.x.ai::grok-client'].refresh_token, 'rotated-grok-refresh');
    assert.deepEqual(stored.extra, { keep: true });
    assert.ok(!JSON.stringify(rotated).includes('grok-refresh'));
});
test('normalizes both API schemas, duration-based Codex windows and scoped Claude limits', () => {
    assert.equal(codexLimits(codexUsage).five_hour.remaining_percent, 88);
    assert.equal(codexLimits(codexUsage).seven_day.remaining_percent, 55);
    assert.equal(claudeLimits(claudeUsage).seven_day_fable.remaining_percent, 35);
    for (const utilization of [null, '', undefined, '30']) assert.deepEqual(claudeLimits({ five_hour: { utilization, resets_at: '2030-01-01' } }), {});
    assert.deepEqual(claudeLimits({ five_hour: { utilization: 30, resets_at: null } }), {});
    assert.equal(claudeLimits({ five_hour: { utilization: 150, resets_at: '2030-01-01' } }).five_hour.remaining_percent, 0);
});
test('Kimi Code usage parses weekly and windowed limits and refreshes expired tokens', async t => {
    const data = await setup(t);
    const kimiDir = path.dirname(data.codexFile);
    const kimiFile = path.join(kimiDir, 'kimi-code.json');
    data.options.env.ULANZI_KIMI_CODE_CREDENTIALS = kimiFile;
    data.options.env.KIMI_SHARE_DIR = kimiDir;
    await fs.writeFile(path.join(kimiDir, 'device_id'), 'device-123');
    const token = { access_token: 'kimi-access', refresh_token: 'kimi-refresh', expires_at: time / 1000 + 3600, expires_in: 3600 };
    await fs.writeFile(kimiFile, JSON.stringify(token));
    const kimiUsage = {
        usages: {
            limit_5h: { used_ratio: 0.16, reset_time: '2030-03-18T17:00:00Z' },
            limit_month_total: { used_ratio: 0.2, reset_time: '2030-04-01T00:00:00Z' }
        },
        limits: [
            { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '16', remaining: '84', resetTime: '2030-03-18T12:00:00.123456789Z' } },
            { window: { duration: 10, timeUnit: 'TIME_UNIT_DAY' }, detail: { limit: 10, used: 5, reset_in: 3600 } }
        ]
    };
    const client = createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url === 'https://api.kimi.com/coding/v1/usages') {
            assert.equal(options.headers.Authorization, 'Bearer kimi-access');
            return json(kimiUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } });
    const result = await client();
    const limits = result.providers['kimi-code'].accounts[0].limits;
    assert.equal(limits.five_hour.remaining_percent, 84);
    assert.equal(limits.five_hour.resets_at, '2030-03-18T17:00:00.000Z');
    assert.equal(limits.monthly.remaining_percent, 80);
    assert.equal(limits['window_864000s'].remaining_percent, 50);
    assert.equal(limits['window_864000s'].resets_at, new Date(time + 3600000).toISOString());
    assert.ok(!JSON.stringify(result).includes('kimi-access'));
    assert.ok(!JSON.stringify(result).includes('kimi-refresh'));
    token.expires_at = time / 1000 - 1;
    await fs.writeFile(kimiFile, JSON.stringify(token));
    let refreshes = 0;
    const rotated = await createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url === 'https://auth.kimi.com/api/oauth/token') {
            refreshes++;
            const form = new URLSearchParams(options.body);
            assert.equal(form.get('grant_type'), 'refresh_token');
            assert.equal(form.get('client_id'), '17e5f671-d194-4dfb-9706-5516cb48c098');
            assert.equal(form.get('refresh_token'), 'kimi-refresh');
            assert.equal(options.headers['X-Msh-Device-Id'], 'device-123');
            return json({ access_token: 'rotated-kimi', refresh_token: 'rotated-kimi-refresh', expires_in: 3600 });
        }
        if (url === 'https://api.kimi.com/coding/v1/usages') {
            assert.equal(options.headers.Authorization, 'Bearer rotated-kimi');
            return json(kimiUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } })();
    assert.equal(refreshes, 1);
    assert.ok(rotated.providers['kimi-code'].accounts);
    const stored = JSON.parse(await fs.readFile(kimiFile, 'utf8'));
    assert.equal(stored.access_token, 'rotated-kimi');
    assert.equal(stored.refresh_token, 'rotated-kimi-refresh');
    assert.equal(stored.expires_at, time / 1000 + 3600);
    assert.ok(!JSON.stringify(rotated).includes('rotated-kimi'));
});
test('Kimi Code falls back to pi OAuth tokens and OpenCode API keys', async t => {
    const data = await setup(t);
    const dir = path.dirname(data.codexFile);
    const piFile = path.join(dir, 'pi-auth.json');
    const authFile = path.join(dir, 'opencode.json');
    data.options.env.ULANZI_PI_AUTH = piFile;
    data.options.env.ULANZI_OPENCODE_AUTH = authFile;
    const kimiUsage = { usages: { limit_5h: { used_ratio: 0.2, reset_time: '2030-03-23T12:00:00Z' } } };
    const xaiEntry = { type: 'oauth', access: 'keep-xai', refresh: 'keep-xai-refresh', expires: time + 3600000 };
    await fs.writeFile(piFile, JSON.stringify({
        'kimi-coding': { type: 'oauth', access: 'pi-access', refresh: 'pi-refresh', expires: time - 1 },
        xai: xaiEntry
    }));
    await fs.writeFile(authFile, JSON.stringify({ 'kimi-code-plan-cn': { type: 'api', key: 'cn-key' } }));
    const result = await createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url === 'https://auth.kimi.com/api/oauth/token') {
            const form = new URLSearchParams(options.body);
            assert.equal(form.get('refresh_token'), 'pi-refresh');
            assert.ok(!options.headers['X-Msh-Device-Id']);
            return json({ access_token: 'pi-rotated', refresh_token: 'pi-rotated-refresh', expires_in: 3600 });
        }
        if (url === 'https://api.kimi.com/coding/v1/usages') {
            assert.equal(options.headers.Authorization, 'Bearer pi-rotated');
            return json(kimiUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } })();
    assert.equal(result.providers['kimi-code'].accounts[0].limits.five_hour.remaining_percent, 80);
    const stored = JSON.parse(await fs.readFile(piFile, 'utf8'));
    assert.equal(stored['kimi-coding'].access, 'pi-rotated');
    assert.equal(stored['kimi-coding'].refresh, 'pi-rotated-refresh');
    assert.equal(stored['kimi-coding'].expires, time + 3600000);
    assert.deepEqual(stored.xai, xaiEntry);
    assert.ok(!JSON.stringify(result).includes('pi-rotated'));
    await fs.unlink(piFile);
    const keyed = await createUsageClient({ ...data.options, fetchImpl: async (url, options) => {
        if (url === 'https://api.kimi.com/coding/v1/usages') {
            assert.equal(options.headers.Authorization, 'Bearer cn-key');
            return json(kimiUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } })();
    assert.equal(keyed.providers['kimi-code'].accounts[0].limits.five_hour.remaining_percent, 80);
    assert.ok(!JSON.stringify(keyed).includes('cn-key'));
    await fs.writeFile(authFile, JSON.stringify({ 'kimi-code-plan-global': { type: 'api', key: 'global-key' } }));
    const global = await createUsageClient({ ...data.options, fetchImpl: async url => {
        if (url.includes('kimi')) {
            assert.equal(url, 'https://api.kimi.ai/coding/v1/usages');
            return json(kimiUsage);
        }
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    } })();
    assert.ok(global.providers['kimi-code'].accounts);
});
test('Kimi Code limits drop malformed rows and require usage data', () => {
    const now = () => time;
    assert.equal(kimiCodeLimits({ usages: { limit_5h: { used_ratio: 0.4, reset_time: '2030-03-23T12:00:00Z' } } }, now).five_hour.used_percent, 40);
    assert.equal(kimiCodeLimits({ usages: { limit_month_total: { used_ratio: 1.5, reset_time: '2030-01-01' } } }, now).monthly.remaining_percent, 0);
    assert.equal(kimiCodeLimits({ limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', remaining: '40', resetTime: '2030-01-01' } }] }, now).five_hour.remaining_percent, 40);
    assert.deepEqual(kimiCodeLimits({ usages: { limit_5h: { used_ratio: 'x', reset_time: '2030-01-01' } } }, now), {});
    assert.deepEqual(kimiCodeLimits({ usages: { limit_5h: { used_ratio: 0.4 } } }, now), {});
    assert.deepEqual(kimiCodeLimits({ limits: [{ detail: { limit: 10, used: 5 } }] }, now), {});
    assert.deepEqual(kimiCodeLimits({ limits: [{ window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '', used: 5, resetTime: '2030-01-01' } }] }, now), {});
    assert.deepEqual(kimiCodeLimits({}, now), {});
});
test('fetches providers directly with their CLI tokens and does not expose credentials', async t => {
    const data = await setup(t); const urls = [];
    const fetchImpl = async (url, options) => {
        urls.push(url); assert.equal(options.redirect, 'error');
        if (url.includes('anthropic.com')) {
            assert.equal(options.headers.Authorization, 'Bearer claude-access');
            assert.equal(options.headers['Anthropic-Beta'], 'oauth-2025-04-20'); return json(claudeUsage);
        }
        assert.equal(url, 'https://chatgpt.com/backend-api/wham/usage');
        assert.equal(options.headers['ChatGPT-Account-Id'], 'test-account'); return json(codexUsage);
    };
    const result = await createUsageClient({ ...data.options, fetchImpl })();
    assert.equal(urls.length, 2);
    assert.equal(result.providers.codex.accounts[0].email, 'active@example.com');
    assert.equal(result.providers.claude.accounts[0].limits.five_hour.remaining_percent, 73);
    assert.ok(!JSON.stringify(result).includes('refresh'));
});
test('refreshes expired tokens and atomically preserves unrelated credential fields', async t => {
    const data = await setup(t);
    data.codex.tokens.access_token = jwt({ exp: time / 1000 - 1 });
    data.claude.claudeAiOauth.expiresAt = time - 1;
    await fs.writeFile(data.codexFile, JSON.stringify(data.codex));
    await fs.writeFile(data.claudeFile, JSON.stringify(data.claude));
    let refreshes = 0;
    const fetchImpl = async (url, options) => {
        if (url.endsWith('/oauth/token')) {
            refreshes++;
            const form = new URLSearchParams(options.body);
            assert.equal(form.get('grant_type'), 'refresh_token');
            assert.ok(form.get('client_id'));
            return json({ access_token: 'rotated-access', refresh_token: 'rotated-refresh', expires_in: 3600, id_token: jwt({ email: 'new@example.com' }) });
        }
        assert.equal(options.headers.Authorization, 'Bearer rotated-access');
        return json(url.includes('anthropic') ? claudeUsage : codexUsage);
    };
    const result = await createUsageClient({ ...data.options, fetchImpl })();
    assert.equal(refreshes, 2); assert.ok(result.providers.codex.accounts);
    for (const file of [data.codexFile, data.claudeFile]) assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).other, { keep: true });
    const stored = JSON.parse(await fs.readFile(data.claudeFile, 'utf8'));
    assert.equal(stored.claudeAiOauth.refreshToken, 'rotated-refresh');
    assert.equal(stored.claudeAiOauth.expiresAt, time + 3600000);
    assert.deepEqual(stored.claudeAiOauth.scopes, ['keep']);
});
test('401 refreshes and retries only once; failed provider does not block the other', async t => {
    const data = await setup(t); let attempts = 0; let refreshes = 0;
    const fetchImpl = async url => {
        if (url.includes('anthropic.com')) return json(claudeUsage);
        if (url.endsWith('/oauth/token')) { refreshes++; return json({ access_token: 'new' }); }
        attempts++; return new Response('secret-body', { status: 401 });
    };
    const result = await createUsageClient({ ...data.options, fetchImpl })();
    assert.equal(attempts, 2); assert.equal(refreshes, 1);
    assert.equal(result.providers.codex.error, 'auth_denied');
    assert.ok(result.providers.claude.accounts); assert.ok(!JSON.stringify(result).includes('secret'));
});
test('403 and 429 are not refreshed/retried and missing credentials make no request', async t => {
    const data = await setup(t); let calls = 0;
    const fetchImpl = async url => { calls++; return new Response('', { status: url.includes('anthropic') ? 429 : 403 }); };
    const client = createUsageClient({ ...data.options, fetchImpl });
    const result = await client(); assert.equal(calls, 2);
    assert.equal(result.providers.claude.error, 'rate_limited'); assert.equal(result.providers.codex.error, 'auth_denied');
    await fs.unlink(data.codexFile); await fs.unlink(data.claudeFile);
    const missing = await client(); assert.equal(calls, 2); assert.equal(missing.providers.codex.error, 'auth_missing');
});
test('concurrent CLI credential change is preserved during token refresh', async t => {
    const data = await setup(t);
    data.codex.tokens.access_token = jwt({ exp: 1 }); await fs.writeFile(data.codexFile, JSON.stringify(data.codex));
    const newer = JSON.stringify({ tokens: { access_token: 'newer-login' } });
    const fetchImpl = async url => {
        if (url.includes('anthropic.com')) return json(claudeUsage);
        await fs.writeFile(data.codexFile, newer);
        return json({ access_token: 'older-rotation', refresh_token: 'older-refresh' });
    };
    const result = await createUsageClient({ ...data.options, fetchImpl })();
    assert.equal(result.providers.codex.error, 'credentials_changed');
    assert.equal(await fs.readFile(data.codexFile, 'utf8'), newer);
});
