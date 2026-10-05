const { createHmac, createHash, randomUUID } = require('node:crypto');
const { createProxyFetch } = require('./proxy-fetch.cjs');

const CHINA_OFFSET = 8 * 3600000;
function aliyunTime(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return NaN;
    const timestamp = Date.parse(value.replace(' ', 'T') + '+08:00');
    return Number.isFinite(timestamp) && new Date(timestamp + CHINA_OFFSET).toISOString().slice(0, 19).replace('T', ' ') === value ? timestamp : NaN;
}
function monthlyWindow(startTime, now) {
    const start = aliyunTime(startTime);
    if (!Number.isFinite(start) || !Number.isFinite(now)) throw new Error('invalid_response');
    const anchor = new Date(start + CHINA_OFFSET);
    const current = new Date(now + CHINA_OFFSET);
    // Always advance from the original day, so February cannot shift a Jan 31 plan to the 28th forever.
    function anniversary(months) {
        const month = anchor.getUTCMonth() + months;
        const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), month + 1, 0)).getUTCDate();
        return Date.UTC(anchor.getUTCFullYear(), month, Math.min(anchor.getUTCDate(), lastDay),
            anchor.getUTCHours(), anchor.getUTCMinutes(), anchor.getUTCSeconds()) - CHINA_OFFSET;
    }
    let months = Math.max(0, (current.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + current.getUTCMonth() - anchor.getUTCMonth());
    if (months && anniversary(months) > now) months--;
    return { window_starts_at: new Date(anniversary(months)).toISOString(), resets_at: new Date(anniversary(months + 1)).toISOString() };
}
function number(value) {
    if (typeof value === 'string' && value.trim()) value = Number(value);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function aliyunLimits(row, now) {
    const remaining = number(row.RestPoolValue);
    if (remaining === null || !['CNY', 'USD'].includes(row.Currency)) throw new Error('invalid_response');
    const limit = { remaining_amount: remaining, currency: row.Currency, ...monthlyWindow(row.StartTime, now) };
    const pool = number(row.CurrentPoolValue ?? row.PoolValue);
    if (pool !== null && pool > 0) limit.remaining_percent = Math.max(0, Math.min(100, remaining / pool * 100));
    return { monthly: limit };
}
const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => '%' + char.charCodeAt(0).toString(16).toUpperCase());
function signedParams(config, timestamp, nonce) {
    const params = {
        Action: 'QuerySavingsPlansInstance', Version: '2017-12-14', Format: 'JSON',
        AccessKeyId: config.aliyunAccessKeyId, SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0',
        SignatureNonce: nonce, Timestamp: new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z'),
        InstanceId: config.aliyunInstanceId, PageNum: '1', PageSize: '100'
    };
    const canonical = Object.keys(params).sort().map(key => encode(key) + '=' + encode(params[key])).join('&');
    params.Signature = createHmac('sha1', config.aliyunAccessKeySecret + '&').update('POST&%2F&' + encode(canonical)).digest('base64');
    return new URLSearchParams(params).toString();
}
const AUTH_CODES = new Set(['NotAuthorized', 'Forbidden', 'InvalidAccessKeyId.NotFound', 'InvalidAccessKeyId', 'SignatureDoesNotMatch']);
function createAliyunUsageRoute({ fetchImpl, now = Date.now, nonce = randomUUID, optionsStore = { read: () => ({}) } } = {}) {
    const request = fetchImpl || createProxyFetch({ optionsStore });
    const cache = new Map();
    async function query(config) {
        if (!config.aliyunAccessKeyId || !config.aliyunAccessKeySecret) return { error: 'auth_missing' };
        if (!config.aliyunInstanceId) return { error: 'instance_missing' };
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await request('https://business.aliyuncs.com/', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: signedParams(config, now(), nonce()), signal: controller.signal, redirect: 'error'
            });
            if (response.status === 401 || response.status === 403) return { error: 'auth_denied' };
            if (response.status === 429) return { error: 'rate_limited' };
            let data;
            try { data = await response.json(); } catch (_) { return { error: 'invalid_response' }; }
            if (AUTH_CODES.has(data?.Code)) return { error: 'auth_denied' };
            if (typeof data?.Code === 'string' && /Throttl/i.test(data.Code)) return { error: 'rate_limited' };
            if (!response.ok) return { error: 'request_failed' };
            if (data?.Success !== true || data.Code !== 'Success' || !Array.isArray(data.Data?.Items)) return { error: 'invalid_response' };
            const row = data.Data.Items.find(item => item && item.InstanceId === config.aliyunInstanceId);
            if (!row) return { error: 'instance_not_found' };
            return { accounts: [{ active: true, email: '', limits: aliyunLimits(row, now()) }] };
        } catch (error) {
            return { error: controller.signal.aborted ? 'timeout' : error.message === 'invalid_response' ? 'invalid_response' : 'request_failed' };
        } finally { clearTimeout(timer); }
    }
    return async function aliyunUsageRoute(url, body) {
        const config = {};
        for (const key of ['aliyunInstanceId', 'aliyunAccessKeyId', 'aliyunAccessKeySecret']) {
            config[key] = typeof body?.[key] === 'string' ? body[key].trim().slice(0, 256) : '';
        }
        const key = createHash('sha256').update(JSON.stringify(config)).digest('hex');
        let entry = cache.get(key);
        if (!entry) {
            if (cache.size >= 64) {
                const idle = [...cache].find(([, value]) => !value.pending);
                if (idle) cache.delete(idle[0]);
                else throw new Error('request_failed');
            }
            entry = { data: null, pending: null, lastAttempt: -Infinity };
        }
        cache.delete(key); cache.set(key, entry);
        if (entry.pending) return entry.pending;
        const force = url.searchParams.get('refresh') === '1';
        if (entry.data && (now() - entry.lastAttempt < 90000 || (!force && now() - entry.data.fetchedAt < 30 * 60000))) return entry.data;
        entry.lastAttempt = now();
        entry.pending = Promise.resolve().then(async () => {
            try {
                entry.data = { providers: { aliyun: await query(config) }, fetchedAt: now() };
                return entry.data;
            } finally { entry.pending = null; }
        });
        return entry.pending;
    };
}
module.exports = { createAliyunUsageRoute, monthlyWindow, aliyunLimits, signedParams };
