// Direct API contract follows ulanzi-studio-niri's ai_usage.py (8ff9e254).
// Credential contents and upstream response bodies must never be logged.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const PROVIDERS = {
    claude: {
        usage: 'https://api.anthropic.com/api/oauth/usage',
        token: 'https://platform.claude.com/v1/oauth/token',
        client: '9d1c250a-e61b-44d9-88ed-5944d1962f5e'
    },
    codex: {
        usage: 'https://chatgpt.com/backend-api/wham/usage',
        token: 'https://auth.openai.com/oauth/token',
        client: 'app_EMoamEEZ73f0CkXaXp7hrann'
    }
};
class UsageError extends Error {
    constructor(code, status) { super(code); this.code = code; this.status = status; }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function jwtClaims(token) {
    try {
        const value = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        return object(value) ? value : {};
    } catch (_) { return {}; }
}
function normalizedLimit(used, reset) {
    if (typeof used !== 'number' || !Number.isFinite(used)) return null;
    const timestamp = typeof reset === 'number' ? reset * 1000 : typeof reset === 'string' ? Date.parse(reset) : NaN;
    if (!Number.isFinite(timestamp) || timestamp <= 0 || !Number.isFinite(new Date(timestamp).getTime())) return null;
    return { used_percent: used, remaining_percent: Math.max(0, Math.min(100, 100 - used)), resets_at: new Date(timestamp).toISOString() };
}
function claudeLimits(data) {
    const limits = {};
    for (const key of ['five_hour', 'seven_day', 'seven_day_sonnet', 'seven_day_fable']) {
        const window = data[key];
        const limit = window && normalizedLimit(window.utilization, window.resets_at);
        if (limit) limits[key] = limit;
    }
    for (const entry of Array.isArray(data.limits) ? data.limits : []) {
        if (!object(entry)) continue;
        let key = { session: 'five_hour', weekly_all: 'seven_day' }[entry.kind];
        if (entry.kind === 'weekly_scoped') {
            const name = entry.scope?.model?.display_name;
            const slug = typeof name === 'string' ? name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') : '';
            key = slug ? 'seven_day_' + slug : null;
        }
        const limit = normalizedLimit(entry.percent, entry.resets_at);
        if (key && limit && !limits[key]) limits[key] = limit;
    }
    return limits;
}
function codexLimits(data) {
    if (!object(data.rate_limit)) throw new UsageError('invalid_response');
    const limits = {};
    for (const field of ['primary_window', 'secondary_window']) {
        const window = data.rate_limit[field];
        if (!object(window)) continue;
        const duration = window.limit_window_seconds;
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0) continue;
        const match = [[18000, 'five_hour'], [604800, 'seven_day'], [2592000, 'thirty_day']]
            .find(([seconds]) => duration >= seconds * 0.95 && duration <= seconds * 1.05);
        const key = match ? match[1] : 'window_' + duration + 's';
        const limit = normalizedLimit(window.used_percent, window.reset_at);
        if (limit) limits[key] = limit;
    }
    return limits;
}
function grokLimits(data) {
    const config = object(data.config) ? data.config : data;
    const period = object(config.currentPeriod) ? config.currentPeriod : null;
    const used = typeof config.creditUsagePercent === 'number' && Number.isFinite(config.creditUsagePercent) ? config.creditUsagePercent : 0;
    const limit = normalizedLimit(used, (period && period.end) || config.billingPeriodEnd);
    return limit ? { weekly: limit } : {};
}
function kimiNumber(value) {
    if (typeof value === 'string') {
        if (!value.trim()) return null;
        value = Number(value);
    }
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function kimiCodeReset(data, now) {
    const reset = data.reset_at ?? data.resetAt ?? data.reset_time ?? data.resetTime;
    const timestamp = typeof reset === 'number' ? reset * 1000 : typeof reset === 'string' ? Date.parse(reset) : NaN;
    if (Number.isFinite(timestamp)) return timestamp;
    const seconds = kimiNumber(data.reset_in ?? data.resetIn ?? data.ttl);
    return seconds !== null && seconds > 0 ? now() + seconds * 1000 : NaN;
}
// Windowed quota row: { limit, used | remaining, resetTime } with string values.
function kimiCodeQuota(data, now) {
    if (!object(data)) return null;
    const limit = kimiNumber(data.limit);
    let used = kimiNumber(data.used);
    if (used === null && limit !== null) {
        const remaining = kimiNumber(data.remaining);
        if (remaining !== null) used = limit - remaining;
    }
    if (used === null || limit === null || limit <= 0) return null;
    return normalizedLimit(used / limit * 100, kimiCodeReset(data, now) / 1000);
}
// Named plan quota: { used_ratio, reset_time }.
function kimiCodeRatio(data, now) {
    if (!object(data)) return null;
    const ratio = kimiNumber(data.used_ratio);
    if (ratio === null) return null;
    return normalizedLimit(ratio * 100, kimiCodeReset(data, now) / 1000);
}
function kimiCodeWindowSeconds(item, detail) {
    for (const source of [item.window, item, detail]) {
        if (!object(source)) continue;
        const duration = kimiNumber(source.duration);
        if (!duration || duration <= 0) continue;
        const unit = typeof source.timeUnit === 'string' ? source.timeUnit.toUpperCase() : '';
        return duration * (unit.includes('MINUTE') ? 60 : unit.includes('HOUR') ? 3600 : unit.includes('DAY') ? 86400 : 1);
    }
    return 0;
}
const KIMI_USAGE_KEYS = { limit_5h: 'five_hour', limit_month_total: 'monthly' };
function kimiCodeLimits(data, now = Date.now) {
    const limits = {};
    const usages = object(data.usages) ? data.usages : {};
    for (const [name, key] of Object.entries(KIMI_USAGE_KEYS)) {
        const limit = kimiCodeRatio(usages[name], now);
        if (limit) limits[key] = limit;
    }
    for (const item of Array.isArray(data.limits) ? data.limits : []) {
        if (!object(item)) continue;
        const detail = object(item.detail) ? item.detail : item;
        const limit = kimiCodeQuota(detail, now);
        if (!limit) continue;
        const seconds = kimiCodeWindowSeconds(item, detail);
        const match = [[18000, 'five_hour'], [604800, 'seven_day'], [2592000, 'thirty_day']]
            .find(([target]) => seconds >= target * 0.95 && seconds <= target * 1.05);
        const key = match ? match[1] : seconds ? 'window_' + seconds + 's' : null;
        if (key && !limits[key]) limits[key] = limit;
    }
    return limits;
}
async function readCredential(file) {
    try {
        const raw = await fs.readFile(file, 'utf8');
        const data = JSON.parse(raw.replace(/^\uFEFF/, ''));
        if (!object(data)) throw new Error();
        return { raw, data };
    } catch (_) { throw new UsageError('auth_missing'); }
}
async function writeCredential(file, expectedRaw, data) {
    const temporary = path.join(path.dirname(file), '.' + path.basename(file) + '.' + randomUUID() + '.tmp');
    try {
        const handle = await fs.open(temporary, 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify(data)); await handle.sync(); }
        finally { await handle.close(); }
        // Preserve a login/refresh performed by the CLI while our request ran.
        if (await fs.readFile(file, 'utf8') !== expectedRaw) throw new UsageError('credentials_changed');
        await fs.rename(temporary, file);
    } catch (error) {
        if (error instanceof UsageError) throw error;
        throw new UsageError('credential_write_failed');
    } finally { await fs.unlink(temporary).catch(() => {}); }
}

function createUsageClient({ env = process.env, home = os.homedir(), fetchImpl = fetch, now = Date.now } = {}) {
    const files = {
        claude: env.ULANZI_CLAUDE_CREDENTIALS || path.join(env.CLAUDE_CONFIG_DIR || path.join(home, '.claude'), '.credentials.json'),
        codex: env.ULANZI_CODEX_CREDENTIALS || path.join(env.CODEX_HOME || path.join(home, '.codex'), 'auth.json')
    };
    async function request(url, options) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetchImpl(url, { ...options, redirect: 'error', signal: controller.signal });
            if (!response.ok) {
                await response.body?.cancel();
                throw new UsageError(response.status === 401 || response.status === 403 ? 'auth_denied' : response.status === 429 ? 'rate_limited' : 'request_failed', response.status);
            }
            const reader = response.body.getReader();
            const chunks = [];
            let size = 0;
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 1024 * 1024) { await reader.cancel(); throw new UsageError('invalid_response'); }
                chunks.push(Buffer.from(value));
            }
            const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (!object(data)) throw new UsageError('invalid_response');
            return data;
        } catch (error) {
            if (error instanceof UsageError) throw error;
            throw new UsageError(controller.signal.aborted ? 'timeout' : 'request_failed');
        } finally { clearTimeout(timeout); }
    }
    async function provider(name) {
        try {
            const config = PROVIDERS[name];
            const file = files[name];
            let credential = await readCredential(file);
            const tokens = () => name === 'claude' ? credential.data.claudeAiOauth : credential.data.tokens;
            const accessToken = () => name === 'claude' ? tokens()?.accessToken : tokens()?.access_token;
            if (typeof accessToken() !== 'string' || !accessToken()) throw new UsageError('auth_missing');
            async function refresh() {
                // Re-read before rotating: another CLI may already have refreshed.
                const latest = await readCredential(file);
                if (latest.raw !== credential.raw) { credential = latest; return; }
                const refreshToken = name === 'claude' ? tokens().refreshToken : tokens().refresh_token;
                if (typeof refreshToken !== 'string' || !refreshToken) throw new UsageError('auth_denied');
                const result = await request(config.token, {
                    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: config.client }).toString()
                });
                if (typeof result.access_token !== 'string' || !result.access_token) throw new UsageError('invalid_response');
                if (name === 'claude') {
                    tokens().accessToken = result.access_token;
                    if (typeof result.refresh_token === 'string' && result.refresh_token) tokens().refreshToken = result.refresh_token;
                    tokens().expiresAt = typeof result.expires_in === 'number' && result.expires_in > 0 ? now() + result.expires_in * 1000 : 0;
                } else {
                    tokens().access_token = result.access_token;
                    if (typeof result.refresh_token === 'string' && result.refresh_token) tokens().refresh_token = result.refresh_token;
                    if (typeof result.id_token === 'string' && result.id_token) tokens().id_token = result.id_token;
                    credential.data.last_refresh = new Date(now()).toISOString();
                }
                await writeCredential(file, credential.raw, credential.data);
                credential = await readCredential(file);
            }
            const expires = name === 'claude' ? tokens().expiresAt : jwtClaims(accessToken()).exp * 1000;
            let refreshed = false;
            if (typeof expires === 'number' && expires > 0 && expires <= now() + 30000) { await refresh(); refreshed = true; }
            async function usageRequest() {
                const token = accessToken();
                if (typeof token !== 'string' || !token) throw new UsageError('auth_missing');
                const headers = { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': 'ulanzi-js-widgets/1.0' };
                if (name === 'claude') {
                    headers['Anthropic-Beta'] = 'oauth-2025-04-20';
                    headers['User-Agent'] = 'claude-code/0.0.0-dev';
                } else if (typeof tokens().account_id === 'string' && tokens().account_id) {
                    headers['ChatGPT-Account-Id'] = tokens().account_id;
                }
                return request(config.usage, { headers });
            }
            let data;
            try { data = await usageRequest(); }
            catch (error) {
                if (error.status !== 401 || refreshed) throw error;
                await refresh();
                data = await usageRequest();
            }
            const limits = name === 'claude' ? claudeLimits(data) : codexLimits(data);
            if (!Object.keys(limits).length) throw new UsageError('invalid_response');
            const email = name === 'codex' ? jwtClaims(tokens().id_token || '').email : '';
            return { accounts: [{ email: typeof email === 'string' ? email : '', active: true, limits }] };
        } catch (error) {
            return { error: error instanceof UsageError ? error.code : 'request_failed' };
        }
    }
    async function openCodeAuth() {
        const file = env.ULANZI_OPENCODE_AUTH || path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'opencode', 'auth.json');
        return (await readCredential(file)).data;
    }
    function apiKey(auth, name) {
        const entry = auth[name];
        return entry?.type === 'api' && typeof entry.key === 'string' ? entry.key.trim() : '';
    }
    async function openCodeGo() {
        try {
            const key = (env.OPENCODE_GO_API_KEY || '').trim() || apiKey(await openCodeAuth(), 'opencode-go');
            if (!key) throw new UsageError('auth_missing');
            const data = await request('https://opencode.ai/zen/go/v1/usage', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + key } });
            if (!object(data.usage)) throw new UsageError('invalid_response');
            const limits = {};
            for (const name of ['rolling', 'weekly', 'monthly']) {
                const window = data.usage[name];
                const limit = window && normalizedLimit(window.percent, window.resetsAt);
                if (limit) limits[name] = limit;
            }
            if (!Object.keys(limits).length) throw new UsageError('invalid_response');
            return { accounts: [{ email: '', active: true, limits }] };
        } catch (error) { return { error: error instanceof UsageError ? error.code : 'request_failed' }; }
    }
    async function moonshot(china = false) {
        try {
            const configuredBase = (env.MOONSHOT_BASE_URL || 'https://api.moonshot.ai/v1').replace(/\/$/, '');
            let key = china ? (env.MOONSHOT_CN_API_KEY || (configuredBase === 'https://api.moonshot.cn/v1' ? env.MOONSHOT_API_KEY : '') || '').trim() : (env.MOONSHOT_API_KEY || '').trim();
            let base = china ? 'https://api.moonshot.cn/v1' : configuredBase;
            if (!key) {
                const auth = await openCodeAuth();
                const name = (china ? ['moonshotai-cn'] : ['moonshotai', 'moonshotai-cn']).find(name => apiKey(auth, name));
                if (!name) throw new UsageError('auth_missing');
                key = apiKey(auth, name);
                base = name === 'moonshotai-cn' ? 'https://api.moonshot.cn/v1' : 'https://api.moonshot.ai/v1';
            }
            if (!['https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1'].includes(base)) throw new UsageError('request_failed');
            const data = await request(base + '/users/me/balance', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + key } });
            const balance = data.data?.available_balance;
            if (data.code !== 0 || typeof balance !== 'number' || !Number.isFinite(balance)) throw new UsageError('invalid_response');
            return { accounts: [{ email: '', active: true, limits: { balance: { remaining_amount: balance, currency: base.includes('.cn/') ? 'CNY' : 'USD' } } }] };
        } catch (error) { return { error: error instanceof UsageError ? error.code : 'request_failed' }; }
    }
    async function grok() {
        try {
            const file = env.ULANZI_GROK_CREDENTIALS || path.join(env.GROK_HOME || path.join(home, '.grok'), 'auth.json');
            let credential = await readCredential(file);
            const session = () => Object.values(credential.data).find(entry => object(entry) && typeof entry.key === 'string' && entry.key) || null;
            if (!session()) throw new UsageError('auth_missing');
            async function refresh() {
                const latest = await readCredential(file);
                if (latest.raw !== credential.raw) { credential = latest; return; }
                const entry = session();
                if (typeof entry.refresh_token !== 'string' || !entry.refresh_token) throw new UsageError('auth_denied');
                const clientId = typeof entry.oidc_client_id === 'string' && entry.oidc_client_id ? entry.oidc_client_id : '';
                if (!clientId) throw new UsageError('auth_denied');
                const result = await request('https://auth.x.ai/oauth2/token', {
                    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: entry.refresh_token, client_id: clientId }).toString()
                });
                if (typeof result.access_token !== 'string' || !result.access_token) throw new UsageError('invalid_response');
                entry.key = result.access_token;
                if (typeof result.refresh_token === 'string' && result.refresh_token) entry.refresh_token = result.refresh_token;
                if (typeof result.expires_in === 'number' && result.expires_in > 0) entry.expires_at = new Date(now() + result.expires_in * 1000).toISOString();
                await writeCredential(file, credential.raw, credential.data);
                credential = await readCredential(file);
            }
            const expires = Date.parse(session().expires_at) || jwtClaims(session().key).exp * 1000;
            let refreshed = false;
            if (typeof expires === 'number' && expires > 0 && expires <= now() + 30000) { await refresh(); refreshed = true; }
            async function usageRequest() {
                const token = session()?.key;
                if (typeof token !== 'string' || !token) throw new UsageError('auth_missing');
                return request('https://cli-chat-proxy.grok.com/v1/billing?format=credits', {
                    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': 'ulanzi-js-widgets/1.0' }
                });
            }
            let data;
            try { data = await usageRequest(); }
            catch (error) {
                if (error.status !== 401 || refreshed) throw error;
                await refresh();
                data = await usageRequest();
            }
            const limits = grokLimits(data);
            if (!Object.keys(limits).length) throw new UsageError('invalid_response');
            const email = session().email;
            return { accounts: [{ email: typeof email === 'string' ? email : '', active: true, limits }] };
        } catch (error) { return { error: error instanceof UsageError ? error.code : 'request_failed' }; }
    }
    async function kimiCode() {
        try {
            const shareDir = env.KIMI_SHARE_DIR || path.join(home, '.kimi');
            const cliFile = env.ULANZI_KIMI_CODE_CREDENTIALS || path.join(shareDir, 'credentials', 'kimi-code.json');
            const piFile = env.ULANZI_PI_AUTH || path.join(env.PI_CODING_AGENT_DIR || path.join(home, '.pi', 'agent'), 'auth.json');
            async function cliHeaders() {
                const headers = { 'X-Msh-Platform': 'kimi_cli' };
                try {
                    const deviceId = (await fs.readFile(path.join(shareDir, 'device_id'), 'utf8')).trim();
                    if (deviceId) headers['X-Msh-Device-Id'] = deviceId;
                } catch (_) { /* The device id header is best-effort. */ }
                return headers;
            }
            async function refreshToken(refreshValue, headers) {
                const result = await request('https://auth.kimi.com/api/oauth/token', {
                    method: 'POST',
                    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
                    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshValue, client_id: '17e5f671-d194-4dfb-9706-5516cb48c098' }).toString()
                });
                if (typeof result.access_token !== 'string' || !result.access_token) throw new UsageError('invalid_response');
                return result;
            }
            async function usages(token) {
                if (typeof token !== 'string' || !token) throw new UsageError('auth_missing');
                const base = (env.KIMI_CODE_BASE_URL || 'https://api.kimi.com/coding/v1').replace(/\/+$/, '');
                return request(base + '/usages', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token, 'User-Agent': 'ulanzi-js-widgets/1.0' } });
            }
            // layout adapts each tool's credential file to { access, refresh, expires(ms) }.
            async function oauthUsage(file, layout) {
                let credential = await readCredential(file);
                const view = () => layout.tokens(credential.data);
                if (typeof view().access !== 'string' || !view().access) throw new UsageError('auth_missing');
                async function refresh() {
                    const latest = await readCredential(file);
                    if (latest.raw !== credential.raw) { credential = latest; return; }
                    if (typeof view().refresh !== 'string' || !view().refresh) throw new UsageError('auth_denied');
                    const result = await refreshToken(view().refresh, await layout.headers());
                    layout.apply(credential.data, result, now());
                    await writeCredential(file, credential.raw, credential.data);
                    credential = await readCredential(file);
                }
                const expires = view().expires;
                let refreshed = false;
                if (expires > 0 && expires <= now() + 30000) { await refresh(); refreshed = true; }
                let data;
                try { data = await usages(view().access); }
                catch (error) {
                    if (error.status !== 401 || refreshed) throw error;
                    await refresh();
                    data = await usages(view().access);
                }
                return data;
            }
            const cliLayout = {
                tokens: data => ({ access: data.access_token, refresh: data.refresh_token, expires: typeof data.expires_at === 'number' ? data.expires_at * 1000 : 0 }),
                headers: cliHeaders,
                apply(data, result, timestamp) {
                    data.access_token = result.access_token;
                    if (typeof result.refresh_token === 'string' && result.refresh_token) data.refresh_token = result.refresh_token;
                    const seconds = typeof result.expires_in === 'number' && result.expires_in > 0 ? result.expires_in : 0;
                    data.expires_in = seconds;
                    data.expires_at = seconds ? timestamp / 1000 + seconds : 0;
                }
            };
            const piLayout = {
                tokens(data) {
                    const entry = object(data['kimi-coding']) && data['kimi-coding'].type === 'oauth' ? data['kimi-coding'] : {};
                    return { access: entry.access, refresh: entry.refresh, expires: typeof entry.expires === 'number' ? entry.expires : 0 };
                },
                headers: async () => ({}),
                apply(data, result, timestamp) {
                    const entry = data['kimi-coding'];
                    entry.access = result.access_token;
                    if (typeof result.refresh_token === 'string' && result.refresh_token) entry.refresh = result.refresh_token;
                    if (typeof result.expires_in === 'number' && result.expires_in > 0) entry.expires = timestamp + result.expires_in * 1000;
                }
            };
            async function apiKeyUsage() {
                const auth = await openCodeAuth();
                const entry = [['kimi-code-plan-cn', 'https://api.kimi.com/coding/v1'], ['kimi-code-plan-global', 'https://api.kimi.ai/coding/v1']]
                    .map(([name, base]) => ({ key: apiKey(auth, name), base }))
                    .find(candidate => candidate.key);
                if (!entry) throw new UsageError('auth_missing');
                return request(entry.base + '/usages', { headers: { Accept: 'application/json', Authorization: 'Bearer ' + entry.key, 'User-Agent': 'ulanzi-js-widgets/1.0' } });
            }
            let data;
            try { data = await oauthUsage(cliFile, cliLayout); }
            catch (error) {
                if (!(error instanceof UsageError) || error.code !== 'auth_missing') throw error;
                try { data = await oauthUsage(piFile, piLayout); }
                catch (piError) {
                    if (!(piError instanceof UsageError) || piError.code !== 'auth_missing') throw piError;
                    data = await apiKeyUsage();
                }
            }
            const limits = kimiCodeLimits(data, now);
            if (!Object.keys(limits).length) throw new UsageError('invalid_response');
            return { accounts: [{ email: '', active: true, limits }] };
        } catch (error) { return { error: error instanceof UsageError ? error.code : 'request_failed' }; }
    }
    return async () => {
        const [claude, codex, go, balance, china, xai, kimi] = await Promise.all([provider('claude'), provider('codex'), openCodeGo(), moonshot(), moonshot(true), grok(), kimiCode()]);
        return { providers: { claude, codex, 'opencode-go': go, moonshot: balance, 'moonshot-cn': china, xai, 'kimi-code': kimi } };
    };
}
module.exports = { createUsageClient, claudeLimits, codexLimits, grokLimits, kimiCodeLimits, writeCredential };
