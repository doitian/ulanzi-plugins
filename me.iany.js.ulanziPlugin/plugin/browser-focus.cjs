const path = require('node:path');
const { execFile } = require('node:child_process');

function createBrowserFocus({ exec = execFile, platform = process.platform, env = process.env } = {}) {
    let pending = null;
    let child = null;
    let disposed = false;

    function focus(url) {
        if (disposed || platform !== 'win32') return Promise.resolve(false);
        let scheme;
        try { scheme = new URL(url).protocol.slice(0, -1); }
        catch (_) { return Promise.resolve(false); }
        if (!['http', 'https', 'microsoft-edge'].includes(scheme)) return Promise.resolve(false);
        if (pending) return pending;
        const executable = path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        pending = new Promise(resolve => {
            child = exec(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'focus-edge.ps1')], {
                windowsHide: true, timeout: 8000, maxBuffer: 1024,
                env: { ...env, ULANZI_BROWSER_SCHEME: scheme }
            }, (error, stdout) => resolve(!error && stdout.trim() === 'focused'));
        }).catch(() => false).finally(() => { pending = null; child = null; });
        return pending;
    }

    return {
        focus,
        dispose() { disposed = true; if (child) child.kill(); }
    };
}

module.exports = { createBrowserFocus };
