// Global device-name aliases shared by every SoundSwitch key. Stored outside the
// plugin folder so reinstalling the plugin does not wipe them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_DEVICE = 200;
const MAX_ALIAS = 64;
const MAX_ALIASES = 500;

function defaultFile() {
    const base = process.env.APPDATA || path.join(os.homedir(), '.config');
    return path.join(base, 'Ulanzi', 'UlanziDeck', 'me.iany.js.ulanziPlugin', 'sound-switch-aliases.json');
}

function sanitizeAliases(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
    const clean = {};
    let count = 0;
    for (const device of Object.keys(input)) {
        if (count >= MAX_ALIASES) break;
        const alias = input[device];
        if (typeof device !== 'string' || typeof alias !== 'string') continue;
        const name = device.trim().slice(0, MAX_DEVICE);
        const value = alias.trim().slice(0, MAX_ALIAS);
        if (!name || !value) continue;
        clean[name] = value;
        count++;
    }
    return clean;
}

function createAliasStore({ file = defaultFile() } = {}) {
    return {
        file,
        read() {
            try { return sanitizeAliases(JSON.parse(fs.readFileSync(file, 'utf8'))); }
            catch (_) { return {}; }
        },
        write(aliases) {
            const clean = sanitizeAliases(aliases);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(clean, null, 2) + '\n');
            return clean;
        }
    };
}

module.exports = { createAliasStore, sanitizeAliases, defaultFile };
