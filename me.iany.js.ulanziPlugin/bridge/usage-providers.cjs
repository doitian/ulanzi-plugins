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
    return async () => {
        const [claude, codex, go, balance, china] = await Promise.all([provider('claude'), provider('codex'), openCodeGo(), moonshot(), moonshot(true)]);
        return { providers: { claude, codex, 'opencode-go': go, moonshot: balance, 'moonshot-cn': china } };
    };
}
module.exports = { createUsageClient, claudeLimits, codexLimits, writeCredential };
