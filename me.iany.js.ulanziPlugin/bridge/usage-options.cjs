// Shared AI usage options (the forced HTTP proxy). Stored outside the plugin
// folder so reinstalling the plugin does not wipe them.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_PROXY = 300;

function defaultFile() {
    if (process.env.ULANZI_USAGE_OPTIONS) return process.env.ULANZI_USAGE_OPTIONS;
    const base = process.env.APPDATA || path.join(os.homedir(), '.config');
    return path.join(base, 'Ulanzi', 'UlanziDeck', 'me.iany.js.ulanziPlugin', 'usage-options.json');
}

function sanitizeOptions(input) {
    const clean = { proxy: '' };
    if (input && typeof input === 'object' && typeof input.proxy === 'string') {
        clean.proxy = input.proxy.trim().slice(0, MAX_PROXY);
    }
    return clean;
}

function createOptionsStore({ file = defaultFile() } = {}) {
    return {
        file,
        read() {
            try { return sanitizeOptions(JSON.parse(fs.readFileSync(file, 'utf8'))); }
            catch (_) { return sanitizeOptions(null); }
        },
        write(options) {
            const clean = sanitizeOptions(options);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(clean, null, 2) + '\n');
            return clean;
        }
    };
}

module.exports = { createOptionsStore, sanitizeOptions, defaultFile };
