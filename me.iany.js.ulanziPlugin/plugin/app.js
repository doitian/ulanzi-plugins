/* global $UD, ClashTrafficWidget, AiUsageWidget, AgentStatusWidget, SoundSwitchPlaybackWidget, SoundSwitchRecordingWidget, SoundSwitchMuteWidget, SoundSwitchProfileWidget */

const PLUGIN_UUID = 'me.iany.ulanzistudio.js';
const WIDGETS = {
    'me.iany.ulanzistudio.js.clashTraffic': ClashTrafficWidget,
    'me.iany.ulanzistudio.js.aiUsage': AiUsageWidget,
    'me.iany.ulanzistudio.js.agentStatus': AgentStatusWidget,
    'me.iany.ulanzistudio.js.soundSwitchPlayback': SoundSwitchPlaybackWidget,
    'me.iany.ulanzistudio.js.soundSwitchRecording': SoundSwitchRecordingWidget,
    'me.iany.ulanzistudio.js.soundSwitchMute': SoundSwitchMuteWidget,
    'me.iany.ulanzistudio.js.soundSwitchProfile': SoundSwitchProfileWidget
};
const INSTANCES = {};

$UD.connect(PLUGIN_UUID);

$UD.onConnected(() => {
    forEachInstance((instance) => {
        instance.ensureConnected();
        instance.render();
    });
});

$UD.onAdd((jsn) => {
    const context = jsn.context;
    let instance = INSTANCES[context];

    if (!instance) {
        const Widget = WIDGETS[getActionUuid(jsn)];
        if (!Widget) return;
        instance = new Widget(context);
        INSTANCES[context] = instance;
    }

    instance.updateSettings((jsn && jsn.param) || {});
    instance.ensureConnected();
});

$UD.onSetActive((jsn) => {
    const instance = INSTANCES[jsn.context];
    if (instance) instance.setActive(jsn.active);
});

$UD.onRun((jsn) => {
    const instance = INSTANCES[jsn.context];
    if (instance) instance.handlePress();
});

$UD.onClear((jsn) => {
    if (!jsn.param) return;
    for (const item of jsn.param) {
        const context = item.context;
        const instance = INSTANCES[context];
        if (!instance) continue;
        instance.destroy();
        delete INSTANCES[context];
    }
});

$UD.onParamFromApp(updateInstance);
$UD.onParamFromPlugin(updateInstance);

const BRIDGE_BASE = window.ULANZI_BRIDGE_URL || 'http://127.0.0.1:18765';

function bridgeFetch(url, options = {}) {
    return fetch(url, Object.assign({ cache: 'no-store' }, options, {
        headers: Object.assign({ 'X-Ulanzi-Bridge': '1' }, options.headers || {})
    }));
}

// Property inspectors cannot reach the bridge directly; relay their requests through the main service.
$UD.onSendToPlugin((jsn) => {
    const request = jsn && (jsn.param || jsn.payload);
    if (!request || !request.command || !jsn.context) return;
    const reply = (data) => $UD.sendToPropertyInspector(Object.assign({ command: request.command }, data), jsn.context);
    if (request.command === 'listProfiles') {
        bridgeFetch(BRIDGE_BASE + '/sound-switch/profiles?exe=' + encodeURIComponent(request.exe || ''))
            .then((response) => response.ok ? response.json() : { error: 'offline' })
            .then((data) => reply({ profiles: data.profiles || [], error: data.error || null }))
            .catch(() => reply({ profiles: [], error: 'offline' }));
    } else if (request.command === 'getAliases') {
        bridgeFetch(BRIDGE_BASE + '/sound-switch/aliases')
            .then((response) => response.ok ? response.json() : { error: 'offline' })
            .then((data) => reply({ aliases: data.aliases || {} }))
            .catch(() => reply({ aliases: {} }));
    } else if (request.command === 'setAliases') {
        bridgeFetch(BRIDGE_BASE + '/sound-switch/aliases/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aliases: request.aliases || {} })
        })
            .then((response) => response.ok ? response.json() : { error: 'offline' })
            .then((data) => reply({ aliases: data.aliases || {} }))
            .catch(() => reply({ aliases: {}, error: 'offline' }));
    }
});

function updateInstance(jsn) {
    const instance = INSTANCES[jsn.context];
    if (!instance) return;
    if (jsn.param) instance.updateSettings(jsn.param);
    instance.ensureConnected();
}

function getActionUuid(jsn) {
    if (jsn && jsn.uuid) return jsn.uuid;
    if (!jsn || !jsn.context) return '';
    return jsn.context.split('___')[0];
}

function forEachInstance(callback) {
    for (const context in INSTANCES) {
        if (Object.prototype.hasOwnProperty.call(INSTANCES, context)) {
            callback(INSTANCES[context]);
        }
    }
}

function getAiUsageInstances() {
    return Object.values(INSTANCES)
        .filter(instance => instance instanceof AiUsageWidget && !instance.destroyed)
        .map(instance => instance.getSnapshot());
}
