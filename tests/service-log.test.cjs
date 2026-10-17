const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServiceLog } = require('../me.iany.js.ulanziPlugin/plugin/service-log.cjs');

test('service log appends timestamped events and caps the file size', () => {
    const file = path.join(os.tmpdir(), 'ulanzi-service-log-' + process.pid + '-' + Date.now() + '.log');
    try {
        const log = createServiceLog({ file, maxBytes: 400 });
        log('start', 'pid 1');
        log('stop', 'sigterm');
        const content = fs.readFileSync(file, 'utf8');
        assert.match(content, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z start pid 1/);
        assert.match(content, /stop sigterm/);
        for (let i = 0; i < 100; i++) log('filler', 'x'.repeat(60));
        assert.ok(fs.statSync(file).size <= 400 + 80);
        assert.match(fs.readFileSync(file, 'utf8'), /filler/);
    } finally {
        fs.rmSync(file, { force: true });
    }
});

test('service log swallows filesystem failures', () => {
    const log = createServiceLog({ file: 'Z:\\missing\\drive\\service.log' });
    log('start');
});
