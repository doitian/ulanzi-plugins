/* global $UD */
(function () {
'use strict';
const sources = new Map();
// Supplied by the plugin runtime; the fallback is only for standalone HTML previews.
const AGENTS_URL = (window.ULANZI_BRIDGE_URL || 'http://127.0.0.1:18765') + '/agents';
const POLL_INTERVAL = 2000;
const STALE_AFTER = 30000;
// Highest priority first: the key shows the status that most wants attention.
const STATUSES = ['waiting', 'running', 'done', 'idle'];
const STATUS_COLORS = { waiting: '#f2a65a', running: '#e8cf78', done: '#7daadc', idle: '#85c995' };
const ICON_SIZE = 48;
const ICON_GAP = 10;
const GRAY = '#a0a0a0';
const RED = '#e63c32';
const AGENTS = { all: 'AGENTS', claude: 'CLAUDE', codex: 'CODEX', opencode: 'OPENCODE', grok: 'GROK', pi: 'PI' };
const ICONS = { all: 'all', claude: 'claude', codex: 'codex', opencode: 'opencode', grok: 'grok', pi: 'pi' };

function sourceFor(url) {
    if (sources.has(url)) return sources.get(url);
    const source = { listeners: new Set(), data: null, error: '', pending: null };
    source.refresh = function (force) {
        if (source.pending) return source.pending;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
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
                if (!data || !data.providers || typeof data.providers !== 'object') throw new Error('Invalid response');
                source.data = data;
                source.error = '';
            } catch (_) {
                source.error = 'offline';
            } finally {
                clearTimeout(timeout);
                source.pending = null;
                for (const widget of source.listeners) widget.render();
            }
        });
        return source.pending;
    };
    source.timer = setInterval(() => source.refresh(false), POLL_INTERVAL);
    sources.set(url, source);
    return source;
}

function summarize(providers, agent) {
    const counts = { waiting: 0, running: 0, done: 0, idle: 0 };
    for (const name in providers) {
        if (agent !== 'all' && name !== agent) continue;
        const row = providers[name];
        if (!row || typeof row !== 'object') continue;
        for (const status of STATUSES) {
            const value = row[status];
            if (Number.isInteger(value) && value >= 0) counts[status] += value;
        }
    }
    const status = STATUSES.find(name => counts[name] > 0) || 'idle';
    return { status, count: counts[status], counts };
}

const ERRORS = {
    agent_berth_missing: { center: 'n/a', footer: 'NO CLI', color: GRAY },
    timeout: { center: 'TO', footer: 'AGENT-BERTH', color: RED },
    command_failed: { center: 'Err', footer: 'AGENT-BERTH', color: RED },
    invalid_response: { center: 'Err', footer: 'AGENT-BERTH', color: RED },
    offline: { center: 'Err', footer: 'HELPER', color: RED },
    loading: { center: '...', footer: '', color: GRAY }
};
// Counts need no caption: the glyph already names the status, so only errors explain themselves.
function presentation(state, stale) {
    if (!state.counts) return ERRORS[state.error] || ERRORS.command_failed;
    return { center: String(state.count), footer: '', color: stale ? GRAY : STATUS_COLORS[state.status] };
}
// Status glyphs on a 24-unit grid: bang, play triangle, check, pause.
function drawStatusIcon(ctx, status, x, y, size, color) {
    const unit = size / 24;
    const bar = (gx, gy, gw, gh) => ctx.fillRect(x + gx * unit, y + gy * unit, gw * unit, gh * unit);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    if (status === 'waiting') { bar(9.5, 2, 5, 13); bar(9.5, 18, 5, 5); return; }
    if (status === 'idle') { bar(5, 3, 5, 18); bar(14, 3, 5, 18); return; }
    ctx.beginPath();
    if (status === 'running') {
        ctx.moveTo(x + 5 * unit, y + 2 * unit);
        ctx.lineTo(x + 21 * unit, y + 12 * unit);
        ctx.lineTo(x + 5 * unit, y + 22 * unit);
        ctx.closePath();
        ctx.fill();
        return;
    }
    ctx.lineWidth = 4 * unit;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(x + 3 * unit, y + 13 * unit);
    ctx.lineTo(x + 9.5 * unit, y + 19.5 * unit);
    ctx.lineTo(x + 21 * unit, y + 4.5 * unit);
    ctx.stroke();
}
function fitFont(ctx, text, size, width) {
    do { ctx.font = size + 'px "Segoe UI", sans-serif'; size--; }
    while (size >= 10 && ctx.measureText(text).width > width);
    return ctx.measureText(text).width;
}
// Canvas centers text on the em box, which sits lower than the digits' ink.
function drawCentered(ctx, text, x, centerY) {
    ctx.textBaseline = 'alphabetic'; // Ink metrics are measured from the current baseline.
    const metrics = ctx.measureText(text);
    const ascent = metrics.actualBoundingBoxAscent;
    const descent = metrics.actualBoundingBoxDescent;
    if (typeof ascent === 'number' && typeof descent === 'number') {
        ctx.fillText(text, x, centerY + (ascent - descent) / 2);
    } else {
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, centerY);
    }
    ctx.textBaseline = 'middle';
}
function drawFit(ctx, text, x, y, size, width) {
    fitFont(ctx, text, size, width);
    ctx.fillText(text, x, y);
}

function AgentStatusWidget(context) {
    this.context = context;
    this.settings = {};
    this.active = true;
    this.destroyed = false;
    this.source = null;
    this.icon = null;
    this.iconAgent = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 144;
    this.ctx = this.canvas.getContext('2d');
}
AgentStatusWidget.prototype.updateSettings = function (settings) {
    this.settings = Object.assign({}, this.settings, settings || {});
    if (AGENTS_URL !== this.url) {
        this.detach();
        this.url = AGENTS_URL;
        this.source = sourceFor(AGENTS_URL);
        this.source.listeners.add(this);
        this.source.refresh(false);
    }
    this.render();
};
AgentStatusWidget.prototype.ensureConnected = function () {
    if (this.destroyed) return;
    if (!this.source) this.updateSettings({});
    this.render();
};
AgentStatusWidget.prototype.setActive = function (active) {
    this.active = String(active) === 'true';
    if (this.active) this.ensureConnected();
};
AgentStatusWidget.prototype.handlePress = function () {
    if (this.destroyed) return;
    if (this.source) this.source.refresh(true);
    const target = (this.settings.url || '').trim();
    if (target) $UD.openUrl(target, false, null, this.context);
};
AgentStatusWidget.prototype.detach = function () {
    if (!this.source) return;
    this.source.listeners.delete(this);
    if (!this.source.listeners.size) {
        clearInterval(this.source.timer);
        sources.delete(this.url);
    }
    this.source = null;
};
AgentStatusWidget.prototype.destroy = function () { this.destroyed = true; this.detach(); };
AgentStatusWidget.prototype.render = function () {
    if (this.destroyed || !this.active) return;
    const source = this.source;
    const data = source && source.data;
    const agent = this.settings.agent || 'all';
    const failure = source ? (source.error || (data && data.error) || '') : 'loading';
    // A helper failure keeps the last counts; only a reading that never arrived shows an error.
    const counted = Boolean(data && data.fetchedAt !== null);
    const state = counted ? summarize(data.providers, agent) : { error: failure || 'loading' };
    const stale = Boolean(failure || (counted && Date.now() - data.fetchedAt > STALE_AFTER));
    const ctx = this.ctx;
    ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 144, 144);
    ctx.textBaseline = 'middle';
    if (this.iconAgent !== agent) {
        this.iconAgent = agent;
        const icon = new Image();
        this.icon = icon;
        icon.onload = () => { if (this.icon === icon) this.render(); };
        icon.src = '../resources/agent-status/' + (ICONS[agent] || 'all') + '.svg';
    }
    if (this.icon && this.icon.complete && this.icon.naturalWidth) ctx.drawImage(this.icon, 100, 15, 29, 29);
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
    drawFit(ctx, this.settings.label || AGENTS[agent] || agent.toUpperCase(), 15, 29, 20, 80);
    if (stale && counted) { ctx.fillStyle = GRAY; ctx.font = '9px "Segoe UI", sans-serif'; ctx.fillText('stale', 15, 48); }
    const display = presentation(state, stale);
    if (state.counts) {
        // Status glyph and count fill the middle, centered together as one group.
        const width = fitFont(ctx, display.center, 58, 78);
        const x = Math.max(4, (144 - width - ICON_SIZE - ICON_GAP) / 2);
        drawStatusIcon(ctx, state.status, x, 86 - ICON_SIZE / 2, ICON_SIZE, display.color);
        ctx.fillStyle = display.color;
        drawCentered(ctx, display.center, x + ICON_SIZE + ICON_GAP, 86);
    } else {
        ctx.textAlign = 'center'; ctx.fillStyle = display.color;
        drawFit(ctx, display.center, 72, 76, 44, 132);
        ctx.fillStyle = stale ? GRAY : '#b4b4b4';
        drawFit(ctx, display.footer, 72, 118, 18, 132);
    }
    // Bottom bar: one segment per status, lit when that status has sessions.
    if (state.counts) {
        for (let index = 0; index < STATUSES.length; index++) {
            const count = state.counts[STATUSES[index]];
            ctx.fillStyle = count ? (stale ? GRAY : STATUS_COLORS[STATUSES[index]]) : '#323232';
            ctx.fillRect(6 + index * 34, 132, 30, 8);
        }
    }
    $UD.setBaseDataIcon(this.context, this.canvas.toDataURL('image/png'), '');
};
window.AgentStatusWidget = AgentStatusWidget;
// Pure selection logic is shared with the fixture tests.
AgentStatusWidget.summarize = summarize;
AgentStatusWidget.presentation = presentation;
}());
