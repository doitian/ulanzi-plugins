/* global $UD, Utils */
// Shared property-inspector logic for the four SoundSwitch actions.
(function () {
'use strict';
let settings = {};
let form;
let profileList;
let profileStatus;

function defaults() {
    const base = { label: '', exe: '' };
    if (profileList) return Object.assign(base, { profile: '', icon: '' });
    return base;
}
function applySettings() {
    if (!form) return;
    Utils.setFormValue(Object.assign(defaults(), settings), form);
}
function save() {
    settings = Utils.getFormValue(form);
    $UD.sendParamFromPlugin(settings);
}
function dialogPath(jsn) {
    if (typeof jsn === 'string') return jsn;
    if (!jsn || typeof jsn !== 'object') return '';
    for (const key of ['param', 'payload', 'path', 'file', 'value']) {
        if (typeof jsn[key] === 'string') return jsn[key];
    }
    return '';
}
function requestProfiles() {
    if (!profileList) return;
    profileStatus.textContent = 'Loading profiles...';
    $UD.sendToPlugin({ command: 'listProfiles', exe: (settings.exe || '').trim() });
}
function receiveProfiles(jsn) {
    const data = jsn && (jsn.param || jsn.payload);
    if (!data || data.command !== 'listProfiles') return;
    profileList.textContent = '';
    const names = [];
    for (const row of data.profiles || []) {
        if (!row || typeof row.name !== 'string' || !row.name) continue;
        names.push(row.name);
        const option = document.createElement('option');
        option.value = row.name;
        profileList.appendChild(option);
    }
    profileStatus.textContent = data.error
        ? 'Could not load profiles (' + data.error + '). Check the CLI path and that SoundSwitch is running.'
        : names.length + ' profile(s) loaded from SoundSwitch.';
}
function receive(jsn) {
    if (!jsn || !jsn.param) return;
    settings = Object.assign({}, jsn.param);
    applySettings();
}

window.SoundSwitchPI = {
    init() {
        profileList = document.getElementById('sound-switch-profiles');
        profileStatus = document.getElementById('profile-status');
        $UD.connect();
        $UD.onConnected(() => {
            form = document.querySelector('#property-inspector');
            applySettings();
            document.querySelector('.uspi-wrapper').classList.remove('hidden');
            requestProfiles();
            if (form.dataset.bound) return;
            form.dataset.bound = 'true';
            form.addEventListener('input', Utils.debounce(save));
            const exe = form.elements.exe;
            if (exe && profileList) exe.addEventListener('change', requestProfiles);
            const browse = document.getElementById('browse');
            if (browse) browse.addEventListener('click', () => $UD.selectFileDialog('SoundSwitch.CLI (*.exe)'));
            const reload = document.getElementById('reload-profiles');
            if (reload) reload.addEventListener('click', requestProfiles);
        });
        $UD.onAdd(receive);
        $UD.onParamFromApp(receive);
        $UD.onSelectdialog((jsn) => {
            const picked = dialogPath(jsn);
            if (!picked || !form) return;
            form.elements.exe.value = picked;
            save();
            requestProfiles();
        });
        if (profileList) $UD.onSendToPropertyInspector(receiveProfiles);
    }
};
}());
