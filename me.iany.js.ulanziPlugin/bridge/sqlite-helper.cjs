// One-shot SQLite helper for plugin hosts without node:sqlite (Ulanzi's
// bundled Node 20). Reads { file, sql, params, write } as JSON on stdin and
// prints { rows } or { changes } on stdout. Spawned by sqlite.cjs only.
'use strict';
const { DatabaseSync } = require('node:sqlite');

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > 1024 * 1024) process.exit(2);
});
process.stdin.on('end', () => {
    try {
        const request = JSON.parse(input);
        const db = new DatabaseSync(request.file, request.write ? {} : { readonly: true });
        try {
            if (request.write) db.exec('PRAGMA busy_timeout = 5000');
            const statement = db.prepare(request.sql);
            process.stdout.write(JSON.stringify(request.write
                ? { changes: statement.run(...request.params).changes }
                : { rows: statement.all(...request.params) }));
        } finally { db.close(); }
    } catch (_) { process.exit(1); }
});
