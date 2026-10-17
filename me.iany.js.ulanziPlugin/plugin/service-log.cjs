// Persistent lifecycle log, stored outside the plugin folder so reinstalling
// the plugin does not wipe it. The service dies far from any console, so a
// dead widget is otherwise impossible to diagnose after the fact.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_BYTES = 256 * 1024;

function defaultFile() {
    if (process.env.ULANZI_SERVICE_LOG) return process.env.ULANZI_SERVICE_LOG;
    const base = process.env.APPDATA || path.join(os.homedir(), '.config');
    return path.join(base, 'Ulanzi', 'UlanziDeck', 'me.iany.js.ulanziPlugin', 'service.log');
}

function createServiceLog({ file = defaultFile(), maxBytes = MAX_BYTES } = {}) {
    return function log(event, detail) {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            try {
                if (fs.statSync(file).size > maxBytes) {
                    const keep = fs.readFileSync(file);
                    fs.writeFileSync(file, keep.subarray(keep.length - Math.floor(maxBytes / 2)));
                }
            } catch (_) { /* No log yet. */ }
            const line = new Date().toISOString() + ' ' + event +
                (detail ? ' ' + String(detail).replace(/\s+/g, ' ').slice(0, 2000) : '') + '\n';
            fs.appendFileSync(file, line);
        } catch (_) { /* Logging must never take the service down. */ }
    };
}

module.exports = { createServiceLog, defaultFile };
