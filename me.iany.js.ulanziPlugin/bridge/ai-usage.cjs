// AI usage route: cache and provider logic only; server.cjs owns HTTP.
const { createUsageClient } = require('./usage-providers.cjs');

const ERROR_CODES = new Set(['auth_missing', 'auth_denied', 'rate_limited', 'timeout', 'invalid_response', 'credentials_changed', 'credential_write_failed', 'request_failed']);
function safeError(error) { return ERROR_CODES.has(error) ? error : 'request_failed'; }

// Only expose usage fields, never credential material or upstream error bodies.
function sanitize(data) {
    if (!data || !data.providers || typeof data.providers !== 'object') throw new Error('Invalid usage data');
    function account(row) {
        const result = { email: typeof row.email === 'string' ? row.email : '', active: row.active === true, limits: {} };
        if (row.error) result.error = safeError(row.error);
        for (const [key, value] of Object.entries(row.limits || {})) {
            if (!value || typeof value !== 'object') continue;
            result.limits[key] = {
                remaining_percent: typeof value.remaining_percent === 'number' && Number.isFinite(value.remaining_percent) ? value.remaining_percent : null,
                used_percent: typeof value.used_percent === 'number' && Number.isFinite(value.used_percent) ? value.used_percent : null,
                remaining_amount: typeof value.remaining_amount === 'number' && Number.isFinite(value.remaining_amount) ? value.remaining_amount : null,
                currency: ['USD', 'CNY'].includes(value.currency) ? value.currency : '',
                resets_at: typeof value.resets_at === 'string' ? value.resets_at : null
            };
        }
        return result;
    }
    const providers = {};
    for (const name of ['claude', 'codex', 'opencode-go', 'moonshot', 'moonshot-cn']) {
        const provider = data.providers[name];
        if (!provider || typeof provider !== 'object') continue;
        providers[name] = Array.isArray(provider.accounts)
            ? { accounts: provider.accounts.filter(row => row && typeof row === 'object').map(account) }
            : account(provider); // Normalize single-account provider output.
        if (provider.error) providers[name].error = safeError(provider.error);
    }
    return { providers };
}

function createUsageRoute({ run = createUsageClient(), now = Date.now } = {}) {
    let cache = null;
    let pending = null;
    let lastAttempt = -Infinity;
    let lastError = null;
    async function usage(force) {
        if (pending) return pending;
        if (cache && now() - cache.fetchedAt < 30 * 60 * 1000 && !force && !lastError) return cache;
        if (now() - lastAttempt < 90000) {
            if (lastError) throw lastError;
            return cache;
        }
        lastAttempt = now();
        pending = Promise.resolve().then(async () => {
            try {
                const data = sanitize(await run());
                cache = { ...data, fetchedAt: now() };
                lastError = null;
                return cache;
            } catch (error) {
                lastError = error;
                throw error;
            } finally { pending = null; }
        });
        return pending;
    }
    return async function usageRoute(url) {
        return usage(url.searchParams.get('refresh') === '1');
    };
}

module.exports = { createUsageRoute, sanitize };
