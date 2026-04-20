/* global $UD, Utils */

let ACTION_SETTING = {};
let form = null;

$UD.connect();

$UD.onConnected(() => {
    form = document.querySelector('#property-inspector');

    document.querySelector('.uspi-wrapper').classList.remove('hidden');

    form.addEventListener(
        'input',
        Utils.debounce(() => {
            const value = Utils.getFormValue(form);
            ACTION_SETTING = value;
            $UD.sendParamFromPlugin(ACTION_SETTING);
        })
    );
});

$UD.onAdd((jsn) => {
    if (jsn && jsn.param) settingSaveParam(jsn.param);
});

$UD.onParamFromApp((jsn) => {
    if (jsn && jsn.param) settingSaveParam(jsn.param);
});

function settingSaveParam(params) {
    ACTION_SETTING = params || {};
    Utils.setFormValue(ACTION_SETTING, form);
}
