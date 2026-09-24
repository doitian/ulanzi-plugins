/* global $UD */
(function () {
'use strict';
const sources = new Map();
// Supplied by the plugin runtime; the fallback is only for standalone HTML previews.
const BRIDGE = (window.ULANZI_BRIDGE_URL || 'http://127.0.0.1:18765') + '/sound-switch';
const POLL_INTERVAL = 5000;
const FLASH_MS = 3000;
const RED = '#e63c32';
const GREEN = '#85c995';
const LABEL_STRIP = 28; // Bottom band reserved for the drawn label.
const ICON_SIZE = 144 - LABEL_STRIP;
const ICON_X = (144 - ICON_SIZE) / 2;
// Segoe UI has no CJK glyphs; skia falls back through the rest of the stack per glyph.
const FONT_STACK = '"Segoe UI", "Microsoft YaHei", sans-serif';

const KINDS = {
    playback: { icon: 'playback', endpoint: 'status' },
    recording: { icon: 'recording', endpoint: 'status' },
    mute: { icon: 'mic', endpoint: 'mute' },
    profile: { icon: 'profile', endpoint: 'status' }
};
const ICON_CHOICES = new Set(['profile', 'playback', 'recording', 'mic']);
const ICON_FILES = { playback: 'playback.png', recording: 'recording.png', mic: 'mic.png', profile: 'profile.svg' };
// Canvas cannot render CJK device names; the host-drawn icon label can, so all text rides on it.
const ERRORS = {
    cli_missing: 'NO CLI',
    invalid_path: 'BAD PATH',
    timeout: 'TIMEOUT',
    command_failed: 'CLI ERROR',
    invalid_response: 'CLI ERROR',
    offline: 'HELPER ERROR',
    loading: '...'
};

function sourceFor(endpoint, exe) {
    const url = BRIDGE + '/' + endpoint + '?exe=' + encodeURIComponent(exe || '');
    if (sources.has(url)) return sources.get(url);
    const source = { listeners: new Set(), data: null, error: '', pending: null };
    source.refresh = function () {
        if (source.pending) return source.pending;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        source.pending = Promise.resolve().then(async () => {
            try {
                const response = await fetch(url, {
                    headers: { 'X-Ulanzi-Bridge': '1' }, signal: controller.signal, cache: 'no-store'
                });
                if (!response.ok) throw new Error('Helper error');
                const data = await response.json();
                if (!data || typeof data !== 'object') throw new Error('Invalid response');
                source.data = data;
                source.error = data.error || '';
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
    source.timer = setInterval(() => source.refresh(), POLL_INTERVAL);
    sources.set(url, source);
    return source;
}

function SoundSwitchWidget(context, kind) {
    this.context = context;
    this.kind = KINDS[kind] ? kind : 'playback';
    this.settings = {};
    this.active = true;
    this.destroyed = false;
    this.source = null;
    this.url = null;
    this.icon = null;
    this.loadedIcon = null;
    this.busy = false;
    this.flash = '';
    this.flashTimer = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = 144;
    this.ctx = this.canvas.getContext('2d');
}
SoundSwitchWidget.prototype.updateSettings = function (settings) {
    this.settings = Object.assign({}, this.settings, settings || {});
    const kind = KINDS[this.kind];
    const url = BRIDGE + '/' + kind.endpoint + '?exe=' + encodeURIComponent((this.settings.exe || '').trim());
    if (url !== this.url) {
        this.detach();
        this.url = url;
        this.source = sourceFor(kind.endpoint, (this.settings.exe || '').trim());
        this.source.listeners.add(this);
        this.source.refresh();
    }
    this.render();
};
SoundSwitchWidget.prototype.ensureConnected = function () {
    if (this.destroyed) return;
    if (!this.source) this.updateSettings({});
    else this.source.refresh();
    this.render();
};
SoundSwitchWidget.prototype.setActive = function (active) {
    this.active = String(active) === 'true';
    if (this.active) this.ensureConnected();
};
SoundSwitchWidget.prototype.iconName = function () {
    if (this.kind !== 'profile') return KINDS[this.kind].icon;
    const chosen = (this.settings.icon || '').trim();
    return ICON_CHOICES.has(chosen) ? chosen : 'profile';
};
SoundSwitchWidget.prototype.commandArgs = function () {
    const exe = 'exe=' + encodeURIComponent((this.settings.exe || '').trim());
    if (this.kind === 'playback') return 'command=switch&type=Playback&' + exe;
    if (this.kind === 'recording') return 'command=switch&type=Recording&' + exe;
    if (this.kind === 'mute') return 'command=mute&' + exe;
    return 'command=profile&name=' + encodeURIComponent(this.settings.profile || '') + '&' + exe;
};
SoundSwitchWidget.prototype.handlePress = function () {
    if (this.destroyed || this.busy) return;
    if (this.kind === 'profile' && !(this.settings.profile || '').trim()) return;
    this.busy = true;
    return Promise.resolve().then(async () => {
        let failure = '';
        try {
            const response = await fetch(BRIDGE + '/run?' + this.commandArgs(), {
                method: 'POST', headers: { 'X-Ulanzi-Bridge': '1' }, cache: 'no-store'
            });
            const data = await response.json();
            if (!response.ok || !data.ok) failure = (data && data.error) || 'command_failed';
        } catch (_) {
            failure = 'offline';
        }
        if (this.destroyed) return;
        this.busy = false;
        if (failure) {
            this.flash = failure;
            clearTimeout(this.flashTimer);
            this.flashTimer = setTimeout(() => { this.flash = ''; this.render(); }, FLASH_MS);
        }
        if (this.source) await this.source.refresh();
        this.render();
    });
};
SoundSwitchWidget.prototype.detach = function () {
    if (!this.source) return;
    this.source.listeners.delete(this);
    if (!this.source.listeners.size) {
        clearInterval(this.source.timer);
        sources.delete(this.url);
    }
    this.source = null;
};
SoundSwitchWidget.prototype.destroy = function () {
    this.destroyed = true;
    clearTimeout(this.flashTimer);
    this.detach();
};
SoundSwitchWidget.prototype.state = function () {
    const data = this.source && this.source.data;
    if (!data) return { error: (this.source && this.source.error) || 'loading' };
    if (this.kind === 'mute') {
        if (typeof data.isMuted !== 'boolean') return { error: data.error || 'loading' };
        return { muted: data.isMuted, device: data.deviceName || '', error: data.error || '' };
    }
    if (this.kind === 'profile') {
        const profile = (this.settings.profile || '').trim();
        return { profile, activeProfile: data.activeProfile || '', error: data.error || '' };
    }
    const device = this.kind === 'playback' ? data.playbackDevice : data.recordingDevice;
    return { device: device || '', error: data.error || '' };
};
SoundSwitchWidget.prototype.labelText = function (state) {
    if (state.error && !state.device && !('muted' in state) && !('profile' in state)) {
        return ERRORS[state.error] || ERRORS.command_failed;
    }
    let base;
    if (this.kind === 'mute') {
        base = (state.muted ? 'MUTED' : 'LIVE') + (state.device ? ' ' + state.device : '');
    } else if (this.kind === 'profile') {
        base = state.profile || '-';
    } else {
        base = state.device || 'none';
    }
    const label = (this.settings.label || '').trim();
    return label ? label + ' ' + base : base;
};
SoundSwitchWidget.prototype.render = function () {
    if (this.destroyed || !this.active) return;
    const state = this.flash ? { error: this.flash } : this.state();
    const failed = Boolean(state.error && !state.device && !('muted' in state) && !('profile' in state));
    const ctx = this.ctx;
    ctx.clearRect(0, 0, 144, 144);
    const wanted = this.iconName();
    if (!this.icon || this.loadedIcon !== wanted) {
        this.loadedIcon = wanted;
        const icon = new Image();
        this.icon = icon;
        icon.onload = () => { if (this.icon === icon) this.render(); };
        icon.src = '../resources/sound-switch/' + (ICON_FILES[wanted] || ICON_FILES.profile);
    }
    if (this.icon.complete && this.icon.naturalWidth) ctx.drawImage(this.icon, ICON_X, 0, ICON_SIZE, ICON_SIZE);
    if (this.kind === 'mute') {
        // The mute icon already carries a slash, so state gets a corner dot instead.
        ctx.fillStyle = state.muted ? RED : GREEN;
        ctx.beginPath();
        ctx.arc(14, 14, 10, 0, Math.PI * 2);
        ctx.fill();
    }
    if (this.kind === 'profile' && state.profile && state.activeProfile === state.profile) {
        ctx.strokeStyle = GREEN;
        ctx.lineWidth = 8;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(8, 20);
        ctx.lineTo(18, 30);
        ctx.lineTo(40, 4);
        ctx.stroke();
    }
    drawLabel(ctx, this.labelText(state), failed ? RED : '#ffffff');
    $UD.setBaseDataIcon(this.context, this.canvas.toDataURL('image/png'), '');
};

function drawLabel(ctx, text, color) {
    let size = 18;
    ctx.font = size + 'px ' + FONT_STACK;
    while (size > 10 && ctx.measureText(text).width > 136) {
        size--;
        ctx.font = size + 'px ' + FONT_STACK;
    }
    let shown = text;
    if (ctx.measureText(shown).width > 136) {
        while (shown.length > 1 && ctx.measureText(shown + '…').width > 136) shown = shown.slice(0, -1);
        shown += '…';
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shown, 72, 144 - LABEL_STRIP / 2);
}

function makeConstructor(kind) {
    function SoundSwitchKindWidget(context) { SoundSwitchWidget.call(this, context, kind); }
    SoundSwitchKindWidget.prototype = Object.create(SoundSwitchWidget.prototype);
    SoundSwitchKindWidget.prototype.constructor = SoundSwitchKindWidget;
    return SoundSwitchKindWidget;
}
window.SoundSwitchPlaybackWidget = makeConstructor('playback');
window.SoundSwitchRecordingWidget = makeConstructor('recording');
window.SoundSwitchMuteWidget = makeConstructor('mute');
window.SoundSwitchProfileWidget = makeConstructor('profile');
// Pure state selection is shared with the fixture tests.
SoundSwitchWidget.KINDS = KINDS;
SoundSwitchWidget.ERRORS = ERRORS;
window.SoundSwitchWidget = SoundSwitchWidget;
}());
