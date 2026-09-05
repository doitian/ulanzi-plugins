/* global $UD, Utils */
let settings = {};
let form;
function applySettings() {
    if (!form) return;
    Utils.setFormValue(Object.assign({ provider: 'codex', limit: 'five_hour', account: '', label: '', url: '' }, settings), form);
    updateWindows();
}
function updateWindows() {
    const provider = form.elements.provider.value;
    const windows = {
        codex: ['five_hour', 'seven_day'],
        claude: ['five_hour', 'seven_day', 'seven_day_fable', 'seven_day_sonnet'],
        'opencode-go': ['rolling', 'weekly', 'monthly'],
        moonshot: ['balance'], 'moonshot-cn': ['balance']
    }[provider] || ['five_hour', 'seven_day'];
    for (const option of form.elements.limit.options) option.disabled = !windows.includes(option.value);
    if (!windows.includes(form.elements.limit.value)) form.elements.limit.value = windows[0];

}
$UD.connect();
$UD.onConnected(() => {
    form = document.querySelector('#property-inspector');
    applySettings();
    document.querySelector('.uspi-wrapper').classList.remove('hidden');
    if (form.dataset.bound) return;
    form.dataset.bound = 'true';
    form.addEventListener('input', () => updateWindows());
    form.addEventListener('input', Utils.debounce(() => {
        settings = Utils.getFormValue(form);
        $UD.sendParamFromPlugin(settings);
    }));
});
function receive(jsn) {
    if (!jsn || !jsn.param) return;
    settings = Object.assign({}, jsn.param);
    delete settings.helperUrl;
    applySettings();
}
$UD.onAdd(receive);
$UD.onParamFromApp(receive);
