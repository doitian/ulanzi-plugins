/* global $UD, Utils */
// Shared property-inspector logic for the four SoundSwitch actions.
(function () {
'use strict';
const DEVICE_FIELDS = ['playbackDevice', 'playbackCommunicationDevice', 'recordingDevice', 'recordingCommunicationDevice'];
const ALIAS_MAX = 64;
let settings = {};
let form;
let profileList;
let profileStatus;
let aliasList;
let aliasPicker;
let aliasMap = {};

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
function needsProfiles() {
    return Boolean(profileList || aliasPicker);
}
function requestProfiles() {
    $UD.sendToPlugin({ command: 'listProfiles', exe: (settings.exe || '').trim() });
}
function requestAliases() {
    if (!aliasList) return;
    $UD.sendToPlugin({ command: 'getAliases' });
}
function receiveProfiles(jsn) {
    const data = jsn && (jsn.param || jsn.payload);
    if (!data || data.command !== 'listProfiles') return;
    const names = [];
    for (const row of data.profiles || []) {
        if (!row || typeof row.name !== 'string' || !row.name) continue;
        names.push(row.name);
    }
    if (profileList) {
        while (profileList.options.length > 1) profileList.remove(1);
        for (const name of names) {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            profileList.appendChild(option);
        }
        syncProfileSelection();
        profileStatus.textContent = data.error
            ? 'Could not load profiles (' + data.error + '). Check the CLI path and that SoundSwitch is running.'
            : names.length + ' profile(s) loaded from SoundSwitch.';
    }
    if (aliasPicker) fillAliasDevices(data.profiles || []);
}
function syncProfileSelection() {
    if (!profileList) return;
    const current = (settings.profile || '').trim();
    if (current && !Array.from(profileList.options).some(option => option.value === current)) {
        const option = document.createElement('option');
        option.value = current;
        option.textContent = current;
        profileList.appendChild(option);
    }
    profileList.value = current;
}
function fillAliasDevices(profiles) {
    while (aliasPicker.options.length > 1) aliasPicker.remove(1);
    const seen = new Set(Object.keys(aliasMap));
    for (const row of profiles) {
        if (!row) continue;
        for (const field of DEVICE_FIELDS) {
            const name = typeof row[field] === 'string' ? row[field].trim() : '';
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            aliasPicker.appendChild(option);
        }
    }
    aliasPicker.disabled = aliasPicker.options.length <= 1;
}
function addAliasRow(device, alias) {
    const row = document.createElement('div');
    row.className = 'alias-row';
    const deviceInput = document.createElement('input');
    deviceInput.className = 'alias-device';
    deviceInput.type = 'text';
    deviceInput.placeholder = 'Device';
    deviceInput.value = device || '';
    const nameInput = document.createElement('input');
    nameInput.className = 'alias-name';
    nameInput.type = 'text';
    nameInput.placeholder = 'Alias';
    nameInput.value = alias || '';
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'alias-remove';
    remove.textContent = '\u00d7';
    remove.setAttribute('aria-label', 'Remove alias');
    remove.addEventListener('click', () => { row.remove(); saveAliases(); });
    row.append(deviceInput, nameInput, remove);
    aliasList.appendChild(row);
    return row;
}
function renderAliases() {
    if (!aliasList) return;
    aliasList.textContent = '';
    for (const device of Object.keys(aliasMap)) addAliasRow(device, aliasMap[device]);
}
function collectAliases() {
    const map = {};
    if (!aliasList) return map;
    for (const row of aliasList.children) {
        const device = row.querySelector('.alias-device').value.trim().slice(0, 200);
        const alias = row.querySelector('.alias-name').value.trim().slice(0, ALIAS_MAX);
        if (device && alias) map[device] = alias;
    }
    return map;
}
function saveAliases() {
    if (!aliasList) return;
    aliasMap = collectAliases();
    $UD.sendToPlugin({ command: 'setAliases', aliases: aliasMap });
}
function receiveAliases(jsn) {
    const data = jsn && (jsn.param || jsn.payload);
    if (!data || data.command !== 'getAliases') return;
    aliasMap = data.aliases && typeof data.aliases === 'object' ? data.aliases : {};
    renderAliases();
}
function pickAliasDevice() {
    const device = aliasPicker.value;
    if (!device) return;
    for (const row of aliasList.children) {
        if (row.querySelector('.alias-device').value.trim() === device) {
            row.querySelector('.alias-name').focus();
            return;
        }
    }
    addAliasRow(device, '').querySelector('.alias-name').focus();
}
function receive(jsn) {
    if (!jsn || !jsn.param) return;
    settings = Object.assign({}, jsn.param);
    applySettings();
    syncProfileSelection();
}

window.SoundSwitchPI = {
    init() {
        profileList = document.getElementById('sound-switch-profiles');
        profileStatus = document.getElementById('profile-status');
        aliasList = document.getElementById('device-aliases');
        aliasPicker = document.getElementById('alias-device-picker');
        $UD.connect();
        $UD.onConnected(() => {
            form = document.querySelector('#property-inspector');
            applySettings();
            document.querySelector('.uspi-wrapper').classList.remove('hidden');
            if (needsProfiles()) requestProfiles();
            requestAliases();
            if (form.dataset.bound) return;
            form.dataset.bound = 'true';
            form.addEventListener('input', Utils.debounce(save));
            const exe = form.elements.exe;
            if (exe && needsProfiles()) exe.addEventListener('change', requestProfiles);
            const browse = document.getElementById('browse');
            if (browse) browse.addEventListener('click', () => $UD.selectFileDialog('SoundSwitch.CLI (*.exe)'));
            const reload = document.getElementById('reload-profiles');
            if (reload) reload.addEventListener('click', requestProfiles);
            const add = document.getElementById('add-alias');
            if (add) add.addEventListener('click', () => addAliasRow('', '').querySelector('.alias-device').focus());
            if (aliasPicker) aliasPicker.addEventListener('change', pickAliasDevice);
            if (aliasList) aliasList.addEventListener('input', Utils.debounce(saveAliases));
        });
        $UD.onAdd(receive);
        $UD.onParamFromApp(receive);
        $UD.onSelectdialog((jsn) => {
            const picked = dialogPath(jsn);
            if (!picked || !form) return;
            form.elements.exe.value = picked;
            save();
            if (needsProfiles()) requestProfiles();
        });
        if (needsProfiles() || aliasList) {
            $UD.onSendToPropertyInspector((jsn) => { receiveProfiles(jsn); receiveAliases(jsn); });
        }
    }
};
}());
