const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBrowserFocus } = require('../me.iany.js.ulanziPlugin/plugin/browser-focus.cjs');

test('native focus is Windows-only and ignores non-browser URLs', async () => {
    let calls = 0;
    const exec = () => { calls++; };
    for (const platform of ['linux', 'darwin']) {
        const helper = createBrowserFocus({ platform, exec });
        assert.equal(await helper.focus('https://example.com'), false);
    }
    const helper = createBrowserFocus({ platform: 'win32', exec });
    for (const url of ['invalid', 'file:///C:/test.html', 'mailto:test@example.com', 'javascript:alert(1)']) {
        assert.equal(await helper.focus(url), false);
    }
    assert.equal(calls, 0);
});

test('focus launches a bounded hidden helper without exposing or interpolating URLs', async () => {
    const calls = [];
    let complete;
    const helper = createBrowserFocus({ platform: 'win32', env: { SystemRoot: 'C:\\Windows', EXISTING: 'kept' },
        exec(exe, args, options, callback) {
            calls.push({ exe, args, options }); complete = callback;
            return { kill() {} };
        }
    });
    const first = helper.focus('https://example.com/?private=secret&value="$(anything)"');
    assert.equal(helper.focus('https://chatgpt.com/#settings/Usage'), first);
    assert.equal(calls.length, 1);
    const { exe, args, options } = calls[0];
    assert.equal(exe, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
    assert.equal(path.basename(args.at(-1)), 'focus-edge.ps1');
    assert.ok(args.includes('-NonInteractive'));
    assert.equal(options.windowsHide, true);
    assert.equal(options.timeout, 8000);
    assert.equal(options.env.ULANZI_BROWSER_SCHEME, 'https');
    assert.equal(options.env.EXISTING, 'kept');
    assert.ok(!JSON.stringify(calls).includes('private=secret'));
    complete(null, 'focused\r\n');
    assert.equal(await first, true);
    const next = helper.focus('microsoft-edge:https://example.com/');
    assert.equal(calls.length, 2);
    assert.equal(calls[1].options.env.ULANZI_BROWSER_SCHEME, 'microsoft-edge');
    complete(null, '');
    assert.equal(await next, false);
});

test('focus failures are swallowed and disposing cancels pending focus', async () => {
    const failing = createBrowserFocus({ platform: 'win32', exec() { throw new Error('not installed'); } });
    assert.equal(await failing.focus('https://example.com'), false);
    let complete;
    let killed = 0;
    let calls = 0;
    const helper = createBrowserFocus({ platform: 'win32', exec(exe, args, options, callback) {
        calls++; complete = callback;
        return { kill() { killed++; complete(new Error('killed'), ''); } };
    } });
    const pending = helper.focus('http://example.com');
    helper.dispose();
    assert.equal(killed, 1);
    assert.equal(await pending, false);
    assert.equal(await helper.focus('https://example.com'), false);
    assert.equal(calls, 1);
});
