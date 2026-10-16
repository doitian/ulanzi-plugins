const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { installUncaughtGuard, isWebstreamTeardownError } = require('../me.iany.js.ulanziPlugin/plugin/uncaught-errors.cjs');

const plugin = path.resolve('me.iany.js.ulanziPlugin/plugin/uncaught-errors.cjs');

function teardownError() {
    const error = new TypeError('Invalid state: Controller is already closed');
    error.code = 'ERR_INVALID_STATE';
    error.stack = 'TypeError: Invalid state: Controller is already closed\n' +
        '    at ReadableStreamDefaultController.close (node:internal/webstreams/readablestream:1064:13)\n' +
        '    at IncomingMessage.<anonymous> (node:internal/webstreams/adapters:454:16)';
    return error;
}

test('only the Node web stream adapter teardown error is recognised', () => {
    assert.equal(isWebstreamTeardownError(teardownError()), true);
    for (const error of [null, undefined, new Error('boom'),
        Object.assign(new Error('Invalid state: Controller is already closed'), { code: 'ERR_INVALID_STATE', stack: 'at app.js:1' }),
        Object.assign(new Error('Invalid state: Controller is already closed'), { code: 'ERR_INVALID_STATE',
            stack: 'at ReadableStreamDefaultController.enqueue (node:internal/webstreams/readablestream:1078:13)\n    at app.js:1' }),
        Object.assign(new Error('Controller is already closed'), { code: 'ERR_OTHER', stack: 'node:internal/webstreams/adapters:454' }),
        Object.assign(new Error('something else'), { code: 'ERR_INVALID_STATE', stack: 'node:internal/webstreams/adapters:454' })]) {
        assert.equal(isWebstreamTeardownError(error), false);
    }
});

test('installed guard ignores the teardown error, reports and exits on anything else', () => {
    const proc = new EventEmitter();
    const reported = [];
    const exited = [];
    proc.exit = code => { exited.push(code); };
    installUncaughtGuard({ process: proc, report: error => reported.push(error.message), exit: proc.exit });
    proc.emit('uncaughtException', teardownError());
    assert.deepEqual(reported, []);
    assert.deepEqual(exited, []);
    proc.emit('uncaughtException', new Error('boom'));
    assert.deepEqual(reported, ['boom']);
    assert.deepEqual(exited, [1]);
});

test('a process using the guard survives the teardown error but dies on other errors', async () => {
    const swallow = `
        const { installUncaughtGuard } = require(${JSON.stringify(plugin)});
        installUncaughtGuard();
        const error = new TypeError('Invalid state: Controller is already closed');
        error.code = 'ERR_INVALID_STATE';
        error.stack = 'TypeError: Invalid state: Controller is already closed' +
            '\\n    at ReadableStreamDefaultController.close (node:internal/webstreams/readablestream:1064:13)' +
            '\\n    at IncomingMessage.<anonymous> (node:internal/webstreams/adapters:454:16)';
        setImmediate(() => { throw error; });
        setTimeout(() => { console.log('alive'); process.exit(0); }, 50);
    `;
    const survived = spawn(process.execPath, ['-e', swallow], { windowsHide: true });
    let survivedOut = '';
    survived.stdout.on('data', chunk => { survivedOut += chunk; });
    const [survivorCode] = await new Promise(resolve => survived.once('exit', code => resolve([code])));
    assert.equal(survivorCode, 0);
    assert.match(survivedOut, /alive/);

    const fatal = `
        const { installUncaughtGuard } = require(${JSON.stringify(plugin)});
        installUncaughtGuard();
        setImmediate(() => { throw new Error('boom'); });
        setTimeout(() => { console.log('should not run'); }, 50);
    `;
    const crashed = spawn(process.execPath, ['-e', fatal], { windowsHide: true });
    let fatalErr = '';
    let fatalOut = '';
    crashed.stderr.on('data', chunk => { fatalErr += chunk; });
    crashed.stdout.on('data', chunk => { fatalOut += chunk; });
    const [fatalCode] = await new Promise(resolve => crashed.once('exit', code => resolve([code])));
    assert.equal(fatalCode, 1);
    assert.match(fatalErr, /boom/);
    assert.doesNotMatch(fatalOut, /should not run/);
});
