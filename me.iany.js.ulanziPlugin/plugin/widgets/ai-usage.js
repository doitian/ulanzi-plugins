/* global $UD */
(function () {
'use strict';
const sources = new Map();
// Supplied by the plugin runtime; the fallback is only for standalone HTML previews.
const USAGE_URL = (window.ULANZI_BRIDGE_URL || 'http://127.0.0.1:18765') + '/usage';
const PROVIDER_URLS = {
    claude: 'https://claude.ai/new#settings/usage',
    codex: 'https://chatgpt.com/#settings/Usage',
    'opencode-go': 'https://opencode.ai/go',
    moonshot: 'https://platform.kimi.com/console/account',
    'moonshot-cn': 'https://platform.kimi.com/console/account'
};

function sourceFor(url) {
    if (sources.has(url)) return sources.get(url);
    const source = { listeners: new Set(), data: null, error: '', pending: null };
    source.refresh = function (force) {
        if (source.pending) return source.pending;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 65000);
        source.pending = Promise.resolve().then(async () => {
            try {
                const target = new URL(url);
                if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.username || target.password) {
                    throw new Error('Invalid helper URL');
                }
                if (force) target.searchParams.set('refresh', '1');
                const response = await fetch(target.href, {
                    headers: { 'X-Ulanzi-Bridge': '1' }, signal: controller.signal, cache: 'no-store'
                });
                if (!response.ok) throw new Error('Helper error');
                const data = await response.json();
                if (!data || !data.providers || !Number.isFinite(data.fetchedAt)) throw new Error('Invalid response');
                source.data = data;
                source.error = '';
            } catch (_) {
                source.error = 'Helper offline';
            } finally {
                clearTimeout(timeout);
                source.pending = null;
                for (const widget of source.listeners) widget.render();
            }
        });
        return source.pending;
    };
    source.timer = setInterval(() => source.refresh(false), 60000);
    sources.set(url, source);
    return source;
}

function selectUsage(data, settings) {
    const provider = data && data.providers[settings.provider || 'codex'];
    if (!provider) return { error: 'No provider data' };
    if (provider.error) return { error: {
        auth_missing: 'CLI login required', auth_denied: 'Login expired',
        rate_limited: 'Rate limited', timeout: 'API timeout',
        credentials_changed: 'Login changed - retry', credential_write_failed: 'Credential save failed'
    }[provider.error] || 'API unavailable' };
    const email = (settings.account || '').trim().toLowerCase();
    const row = Array.isArray(provider.accounts)
        ? provider.accounts.find(account => email ? (account.email || '').toLowerCase() === email : account.active === true) ||
            (provider.accounts.length === 1 && !provider.accounts[0].email ? provider.accounts[0] : null)
        : (!email || (provider.email || '').toLowerCase() === email ? provider : null);
    if (!row) return { error: 'No account' };
    if (row.error) return { error: 'Login / retry' };
    const limit = row.limits && row.limits[settings.limit || 'five_hour'];
    if (!limit) return { error: 'No limit data' };
    if (typeof limit.remaining_amount === 'number' && Number.isFinite(limit.remaining_amount)) {
        return { amount: limit.remaining_amount, currency: limit.currency || '' };
    }
    let remaining = limit.remaining_percent;
    if (typeof remaining !== 'number' || !Number.isFinite(remaining)) {
        if (typeof limit.used_percent !== 'number' || !Number.isFinite(limit.used_percent)) return { error: 'No usage data' };
        remaining = 100 - limit.used_percent;
    }
    return { remaining: Math.max(0, Math.min(100, remaining)), reset: Date.parse(limit.resets_at) };
}

const COLORS = { gray: '#a0a0a0', green: '#00c850', yellow: '#f0be00', red: '#e63c32' };
function resetText(reset) {
    if (!Number.isFinite(reset)) return '';
    const seconds = Math.floor((reset - Date.now()) / 1000);
    if (seconds <= 0) return 'now';
    if (seconds < 60) return '<1m';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + 'm';
    if (minutes < 1440) return Math.floor(minutes / 60) + 'h' + (minutes % 60) + 'm';
    return Math.floor(minutes / 1440) + 'd' + Math.floor(minutes % 1440 / 60) + 'h';
}
function balanceParts(amount, currency) {
    const prefix = { USD: '$', CNY: '¥' }[currency] || (currency ? currency + ' ' : '');
    const cents = Math.round(Math.max(0, amount) * 100);
    if (cents < 100000) return [prefix + Math.floor(cents / 100), '.' + String(cents % 100).padStart(2, '0')];
    let divisor = 100;
    for (const suffix of ['K', 'M', 'B', 'T']) {
        divisor *= 1000;
        if (Math.floor(cents / divisor) < 1000 || suffix === 'T') {
            return [prefix + Math.floor(cents / divisor) + suffix, '.' + String(Math.floor(cents % divisor * 1000 / divisor)).padStart(3, '0')];
        }
    }
}
function presentation(usage, stale) {
    if (usage.error) {
        const code = { 'CLI login required': '401', 'Login expired': '401', 'Login / retry': '401', 'Rate limited': '429', 'API timeout': 'TO' }[usage.error];
        const missing = ['No provider data', 'No account', 'No limit data', 'No usage data', 'Loading...'].includes(usage.error);
        return { center: code || (missing ? 'n/a' : 'Err'), footer: '', color: missing ? COLORS.gray : COLORS.red };
    }
    const balance = typeof usage.amount === 'number';
    const parts = balance ? balanceParts(usage.amount, usage.currency) : [Math.round(usage.remaining) + '%', resetText(usage.reset)];
    const thresholds = balance ? (usage.currency === 'CNY' ? [70, 36] : [12, 6]) : [60, 30];
    const value = balance ? usage.amount : usage.remaining;
    return { center: parts[0], footer: parts[1], color: stale ? COLORS.gray : value >= thresholds[0] ? COLORS.green : value >= thresholds[1] ? COLORS.yellow : COLORS.red };
}
function drawFit(ctx, text, x, y, size, width) {
    do { ctx.font = size + 'px "Segoe UI", sans-serif'; size--; }
    while (size >= 10 && ctx.measureText(text).width > width);
    ctx.fillText(text, x, y);
}

function AiUsageWidget(context) {
    this.context = context;
    this.settings = {};
    this.active = true;
    this.destroyed = false;
    this.source = null;
    this.icon = null;
    this.iconProvider = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 144;
    this.ctx = this.canvas.getContext('2d');
}
AiUsageWidget.prototype.updateSettings = function (settings) {
    this.settings = Object.assign({}, this.settings, settings || {});
    delete this.settings.helperUrl; // Ignore URLs saved by older plugin versions.
    const url = USAGE_URL;
    if (url !== this.url) {
        this.detach();
        this.url = url;
        this.source = sourceFor(url);
        this.source.listeners.add(this);
        this.source.refresh(false);
    }
    this.render();
};
AiUsageWidget.prototype.ensureConnected = function () {
    if (this.destroyed) return;
    if (!this.source) this.updateSettings({});
    this.render();
};
AiUsageWidget.prototype.setActive = function (active) {
    this.active = String(active) === 'true';
    if (this.active) this.ensureConnected();
};
AiUsageWidget.prototype.handlePress = function () {
    if (this.destroyed) return;
    if (this.source) this.source.refresh(true);
    const target = (this.settings.url || '').trim() || PROVIDER_URLS[this.settings.provider || 'codex'];
    if (target) $UD.openUrl(target);
};
AiUsageWidget.prototype.detach = function () {
    if (!this.source) return;
    this.source.listeners.delete(this);
    if (!this.source.listeners.size) {
        clearInterval(this.source.timer);
        sources.delete(this.url);
    }
    this.source = null;
};
AiUsageWidget.prototype.destroy = function () { this.destroyed = true; this.detach(); };
AiUsageWidget.prototype.render = function () {
    if (this.destroyed || !this.active) return;
    const source = this.source;
    const usage = source && source.data ? selectUsage(source.data, this.settings) : { error: 'Loading...' };
    const stale = source && (source.error || (source.data && Date.now() - source.data.fetchedAt > 35 * 60000));
    const ctx = this.ctx;
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 144, 144);
    ctx.textBaseline = 'middle';
    const provider = this.settings.provider || 'codex';
    if (this.iconProvider !== provider) {
        this.iconProvider = provider;
        const icon = new Image();
        this.icon = icon;
        icon.onload = () => { if (this.icon === icon) this.render(); };
        icon.src = '../resources/ai-usage/' + ({ claude: 'claude', moonshot: 'moonshot', 'moonshot-cn': 'moonshot', 'opencode-go': 'opencode-go' }[provider] || 'codex') + '.svg';
    }
    if (this.icon && this.icon.complete && this.icon.naturalWidth) ctx.drawImage(this.icon, 100, 15, 29, 29);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
    const label = { five_hour: '5H', seven_day: '7D', seven_day_fable: 'FABLE', seven_day_sonnet: 'SONNET', balance: 'BAL', rolling: 'GO 5H', weekly: 'GO 7D', monthly: 'GO 30D' }[this.settings.limit || 'five_hour'] || this.settings.limit;
    drawFit(ctx, this.settings.label || label, 15, 29, 20, 80);
    const display = presentation(usage, stale);
    ctx.textAlign = 'center'; ctx.fillStyle = display.color;
    drawFit(ctx, display.center, 72, 72, 41, 114);
    ctx.fillStyle = '#b4b4b4';
    drawFit(ctx, display.footer, 72, 124, 20, 114);
    // Keep a stale indication without replacing the reset/decimal footer.
    if (stale) { ctx.fillStyle = COLORS.gray; ctx.font = '9px "Segoe UI", sans-serif'; ctx.fillText('stale', 72, 103); }
    $UD.setBaseDataIcon(this.context, this.canvas.toDataURL('image/png'), '');
};
window.AiUsageWidget = AiUsageWidget;
// Pure selection logic is shared with the fixture tests.
AiUsageWidget.selectUsage = selectUsage;
AiUsageWidget.presentation = presentation;
AiUsageWidget.balanceParts = balanceParts;
}());
