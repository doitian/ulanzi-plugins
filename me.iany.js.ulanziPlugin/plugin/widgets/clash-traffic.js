/* global $UD */

(function () {

const HISTORY_SIZE = 12;
const ICON_SIZE = 144;
const COLOR_BG = '#1e1f22';
const COLOR_UP = '#4caf50';
const COLOR_DOWN = '#2196f3';
const COLOR_TEXT = '#dfdfdf';
const COLOR_GRID = '#2c2d31';
// Clash emits one /traffic frame per second. If we go this long without a
// frame the socket is considered stale (the readyState can lag behind a
// silently dropped TCP connection, e.g. after the host app is restarted).
const STALE_TIMEOUT_MS = 8000;
const WATCHDOG_INTERVAL_MS = 2000;
const DEFAULT_REFRESH_INTERVAL_S = 1;
const MIN_REFRESH_INTERVAL_S = 1;
const MAX_REFRESH_INTERVAL_S = 60;

// One instance is created by the shared plugin service for each key context.

function ClashTrafficWidget(context) {
    this.context = context;
    this.settings = {};
    this.history = []; // [{up, down}]
    this.ws = null;
    this.connected = false;
    this.active = true;
    this.reconnectTimer = null;
    this.reconnectDelay = 1000;
    this.destroyed = false;

    this.canvas = document.createElement('canvas');
    this.canvas.width = ICON_SIZE;
    this.canvas.height = ICON_SIZE;
    this.ctx2d = this.canvas.getContext('2d');

    this.lastMessageAt = 0;
    this.watchdogTimer = setInterval(() => this.checkStale(), WATCHDOG_INTERVAL_MS);

    // Aggregation bucket: incoming /traffic frames arrive ~1Hz from Clash and
    // are summed here, then averaged and flushed to `history` on each sample
    // tick driven by `refreshInterval`.
    this.bucket = { up: 0, down: 0, count: 0 };
    this.sampleTimer = null;
    this.sampleIntervalMs = DEFAULT_REFRESH_INTERVAL_S * 1000;
    this.startSampleTimer();

    this.render();
}

ClashTrafficWidget.prototype.updateSettings = function (settings) {
    const oldUrl = this.buildWsUrl();
    const oldIntervalMs = this.sampleIntervalMs;
    this.settings = Object.assign({}, this.settings, settings || {});
    const newUrl = this.buildWsUrl();
    const newIntervalMs = this.resolveRefreshIntervalMs();
    if (newIntervalMs !== oldIntervalMs) {
        this.sampleIntervalMs = newIntervalMs;
        this.bucket = { up: 0, down: 0, count: 0 };
        this.startSampleTimer();
    }
    if (newUrl !== oldUrl) {
        this.history = [];
        this.connectWs();
    }
    this.render();
};

ClashTrafficWidget.prototype.resolveRefreshIntervalMs = function () {
    let v = Number(this.settings.refreshInterval);
    if (!isFinite(v) || v <= 0) v = DEFAULT_REFRESH_INTERVAL_S;
    if (v < MIN_REFRESH_INTERVAL_S) v = MIN_REFRESH_INTERVAL_S;
    if (v > MAX_REFRESH_INTERVAL_S) v = MAX_REFRESH_INTERVAL_S;
    return Math.round(v * 1000);
};

ClashTrafficWidget.prototype.startSampleTimer = function () {
    if (this.sampleTimer) {
        clearInterval(this.sampleTimer);
        this.sampleTimer = null;
    }
    if (this.destroyed) return;
    this.sampleTimer = setInterval(() => this.flushBucket(), this.sampleIntervalMs);
};

ClashTrafficWidget.prototype.flushBucket = function () {
    if (this.destroyed) return;
    if (!this.connected) return;
    const b = this.bucket;
    // No frames arrived in this window — record a zero sample so the chart
    // still scrolls and idle periods are visible.
    const up = b.count > 0 ? b.up / b.count : 0;
    const down = b.count > 0 ? b.down / b.count : 0;
    this.bucket = { up: 0, down: 0, count: 0 };
    this.history.push({ up: up, down: down });
    if (this.history.length > HISTORY_SIZE) {
        this.history.shift();
    }
    this.render();
};

ClashTrafficWidget.prototype.ensureConnected = function () {
    if (this.destroyed) return;
    // Reconnect if the socket is missing or no longer in OPEN/CONNECTING state.
    // This handles host-app restarts where the plugin process is preserved but
    // existing widget instances may be holding stale or closed sockets,
    // and also covers the first add when the URL happens to match the default.
    const ws = this.ws;
    const alive = ws && (ws.readyState === 0 || ws.readyState === 1);
    if (!alive) {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.reconnectDelay = 1000;
        this.connectWs();
    } else {
        this.render();
    }
};

ClashTrafficWidget.prototype.buildWsUrl = function () {
    const base = (this.settings.wsUrl || 'ws://127.0.0.1:9090/traffic').trim();
    const token = (this.settings.token || '').trim();
    if (!token) return base;
    const sep = base.indexOf('?') >= 0 ? '&' : '?';
    return base + sep + 'token=' + encodeURIComponent(token);
};

ClashTrafficWidget.prototype.setActive = function (active) {
    const wasActive = this.active;
    this.active = !!(active && active.toString() === 'true');
    if (this.active && !wasActive) {
        this.ensureConnected();
    }
    this.render();
};

ClashTrafficWidget.prototype.connectWs = function () {
    this.closeWs();
    if (this.destroyed) return;

    this.lastMessageAt = Date.now();
    this.bucket = { up: 0, down: 0, count: 0 };
    const url = this.buildWsUrl();
    let socket;
    try {
        socket = new WebSocket(url);
    } catch (e) {
        this.scheduleReconnect();
        return;
    }
    this.ws = socket;

    socket.onopen = () => {
        this.connected = true;
        this.reconnectDelay = 1000;
        this.lastMessageAt = Date.now();
        this.render();
    };

    socket.onmessage = (evt) => {
        this.lastMessageAt = Date.now();
        let data;
        try {
            data = JSON.parse(evt.data);
        } catch (e) {
            return;
        }
        const up = Number(data.up) || 0;
        const down = Number(data.down) || 0;
        // Accumulate; the sample timer will average and push to history.
        this.bucket.up += up;
        this.bucket.down += down;
        this.bucket.count += 1;
    };

    socket.onerror = () => {
        // close handler will fire after error
    };

    socket.onclose = () => {
        this.connected = false;
        this.ws = null;
        this.render();
        this.scheduleReconnect();
    };
};

ClashTrafficWidget.prototype.closeWs = function () {
    if (this.ws) {
        try {
            this.ws.onclose = null;
            this.ws.onerror = null;
            this.ws.onmessage = null;
            this.ws.onopen = null;
            this.ws.close();
        } catch (e) { /* ignore */ }
        this.ws = null;
    }
};

ClashTrafficWidget.prototype.scheduleReconnect = function () {
    if (this.destroyed) return;
    if (this.reconnectTimer) return;
    const delay = this.reconnectDelay;
    this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this.connectWs();
    }, delay);
};

ClashTrafficWidget.prototype.handlePress = function () {
    const url = this.connected
        ? (this.settings.onlineUrl || '')
        : (this.settings.offlineUrl || '');
    const target = (url || '').trim();
    if (!target) return;
    $UD.openUrl(target);
};

ClashTrafficWidget.prototype.destroy = function () {
    this.destroyed = true;
    this.closeWs();
    if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
    }
    if (this.watchdogTimer) {
        clearInterval(this.watchdogTimer);
        this.watchdogTimer = null;
    }
    if (this.sampleTimer) {
        clearInterval(this.sampleTimer);
        this.sampleTimer = null;
    }
};

ClashTrafficWidget.prototype.checkStale = function () {
    if (this.destroyed) return;
    if (!this.connected) return;
    if (!this.lastMessageAt) return;
    if (Date.now() - this.lastMessageAt < STALE_TIMEOUT_MS) return;
    // Socket is silently dead — force a reconnect.
    this.connectWs();
};

ClashTrafficWidget.prototype.render = function () {
    if (!this.active) return;
    if (this.connected) {
        this.drawChart();
    } else {
        this.drawOffline();
    }
};

ClashTrafficWidget.prototype.drawOffline = function () {
    $UD.setPathIcon(this.context, 'resources/clash-traffic/offline.svg', '');
};

ClashTrafficWidget.prototype.drawChart = function () {
    const ctx = this.ctx2d;
    const W = ICON_SIZE;
    const H = ICON_SIZE;

    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);

    const last = this.history.length > 0
        ? this.history[this.history.length - 1]
        : { up: 0, down: 0 };

    // Header text: current speeds
    const upText = '\u2191 ' + formatSpeed(last.up);
    const downText = '\u2193 ' + formatSpeed(last.down);
    ctx.font = 'bold 18px "Source Han Sans SC", system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = COLOR_UP;
    ctx.fillText(upText, 6, 6);
    ctx.fillStyle = COLOR_DOWN;
    ctx.fillText(downText, 6, 28);

    // Chart area
    const chartTop = 56;
    const chartBottom = H - 6;
    const chartLeft = 6;
    const chartRight = W - 6;
    const chartW = chartRight - chartLeft;
    const chartH = chartBottom - chartTop;

    // Baseline grid
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(chartLeft, chartBottom);
    ctx.lineTo(chartRight, chartBottom);
    ctx.stroke();

    if (this.history.length === 0) return;

    // Determine scale
    let max = 0;
    for (const r of this.history) {
        if (r.up > max) max = r.up;
        if (r.down > max) max = r.down;
    }
    if (max <= 0) max = 1;

    const n = HISTORY_SIZE;
    const step = chartW / (n - 1);

    const drawLine = (key, color) => {
        ctx.strokeStyle = color;
        ctx.fillStyle = color + '33'; // ~20% opacity
        ctx.lineWidth = 2;
        ctx.beginPath();
        let started = false;
        const pts = [];
        // Right-align newest; pad older slots from the left
        const offset = n - this.history.length;
        for (let i = 0; i < this.history.length; i++) {
            const idx = i + offset;
            const x = chartLeft + idx * step;
            const v = this.history[i][key];
            const y = chartBottom - (v / max) * chartH;
            pts.push({ x, y });
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        // Fill area below line
        if (pts.length > 1) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, chartBottom);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1].x, chartBottom);
            ctx.closePath();
            ctx.fill();
        }
    };

    drawLine('down', COLOR_DOWN);
    drawLine('up', COLOR_UP);

    const dataUrl = this.canvas.toDataURL('image/png');
    $UD.setBaseDataIcon(this.context, dataUrl, '');
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatSpeed(bytesPerSec) {
    const v = Number(bytesPerSec) || 0;
    const units = ['B', 'K', 'M', 'G', 'T'];
    let i = 0;
    let n = v;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    if (i === 0) return n.toFixed(0) + units[i];
    if (n >= 100) return n.toFixed(0) + units[i];
    if (n >= 10) return n.toFixed(1) + units[i];
    return n.toFixed(2) + units[i];
}

window.ClashTrafficWidget = ClashTrafficWidget;

}());
