/* global $UD, ClashTrafficWidget, AiUsageWidget */

const PLUGIN_UUID = 'me.iany.ulanzistudio.js';
const WIDGETS = {
    'me.iany.ulanzistudio.js.clashTraffic': ClashTrafficWidget,
    'me.iany.ulanzistudio.js.aiUsage': AiUsageWidget
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
