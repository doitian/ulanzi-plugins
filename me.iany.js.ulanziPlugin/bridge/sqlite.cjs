// SQLite access for the OpenCode v2 credential store. Prefers node:sqlite
// (Node 22.5+); Ulanzi's bundled Node 20 lacks it, so fall back to a one-shot
// helper process running on the `node` found on PATH (override with
// ULANZI_NODE). Set ULANZI_SQLITE_HELPER=1 to force the helper (tests/debug).
'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');

const HELPER = path.join(__dirname, 'sqlite-helper.cjs');

function builtinSqlite(env) {
    if (env.ULANZI_SQLITE_HELPER === '1') return null;
    try { return require('node:sqlite'); } catch (_) { return null; }
}

function probeHelperNode(env, cache) {
    if (cache.helperNode !== undefined) return Promise.resolve(cache.helperNode);
    const candidate = (env.ULANZI_NODE || '').trim() || 'node';
    return new Promise(resolve => {
        execFile(candidate, ['-e', "require('node:sqlite')"], { timeout: 10000, windowsHide: true }, error => {
            resolve(cache.helperNode = error ? null : candidate);
        });
    });
}

function available({ env, cache }) {
    if (builtinSqlite(env)) return Promise.resolve(true);
    return probeHelperNode(env, cache).then(node => node !== null);
}

function runHelper(node, request) {
    return new Promise((resolve, reject) => {
        const child = execFile(node, [HELPER], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (error, stdout) => {
            if (error) return reject(error);
            try { resolve(JSON.parse(stdout)); } catch (_) { reject(new Error('invalid helper output')); }
        });
        child.stdin.end(JSON.stringify(request));
    });
}

async function run(file, sql, params, { env, cache, write = false }) {
    const sqlite = builtinSqlite(env);
    if (sqlite) {
        const db = new sqlite.DatabaseSync(file, write ? {} : { readonly: true });
        try {
            if (write) db.exec('PRAGMA busy_timeout = 5000');
            const statement = db.prepare(sql);
            return write ? { changes: statement.run(...params).changes } : { rows: statement.all(...params) };
        } finally { db.close(); }
    }
    const node = await probeHelperNode(env, cache);
    if (!node) throw new Error('no sqlite driver available');
    return runHelper(node, { file, sql, params, write });
}

module.exports = {
    available,
    query: (file, sql, params, context) => run(file, sql, params, context).then(result => result.rows),
    execute: (file, sql, params, context) => run(file, sql, params, { ...context, write: true }).then(result => result.changes)
};
