/* global $UD, Utils */
let settings = {};
let form;
function applySettings() {
    if (!form) return;
    Utils.setFormValue(Object.assign({ agent: 'all', label: '', url: '' }, settings), form);
}
$UD.connect();
$UD.onConnected(() => {
    form = document.querySelector('#property-inspector');
    applySettings();
    document.querySelector('.uspi-wrapper').classList.remove('hidden');
    if (form.dataset.bound) return;
    form.dataset.bound = 'true';
    form.addEventListener('input', Utils.debounce(() => {
        settings = Utils.getFormValue(form);
        $UD.sendParamFromPlugin(settings);
    }));
});
function receive(jsn) {
    if (!jsn || !jsn.param) return;
    settings = Object.assign({}, jsn.param);
    applySettings();
}
$UD.onAdd(receive);
$UD.onParamFromApp(receive);
