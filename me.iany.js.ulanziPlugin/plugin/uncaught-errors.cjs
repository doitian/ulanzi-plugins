// Ulanzi Studio bundles Node 20.12.2, whose Readable.toWeb adapter throws
// ERR_INVALID_STATE when its stream is cancelled after the Node stream ended but
// before it closed. proxy-fetch.cjs no longer uses that adapter; this is a backstop
// so a dependency hitting it cannot kill the shared widget service and freeze every key.
// The plugin installs this guard so only that known adapter failure is ignored;
// any other uncaught error keeps the default crash-and-restart behaviour.
// The adapter frame, not just any web stream frame: plugin code that enqueues or
// closes an already closed controller throws the same error and must still crash.
const WEBSTREAM_ADAPTER = 'node:internal/webstreams/adapters';
const CLOSED_CONTROLLER = /Controller is already closed/;

function isWebstreamTeardownError(error) {
    if (!error || error.code !== 'ERR_INVALID_STATE' || !CLOSED_CONTROLLER.test(String(error.message))) return false;
    return String(error.stack || '').includes(WEBSTREAM_ADAPTER);
}

function installUncaughtGuard({ process: proc = process, report = error => console.error(error), exit = code => proc.exit(code) } = {}) {
    proc.on('uncaughtException', error => {
        if (isWebstreamTeardownError(error)) return;
        report(error);
        exit(1);
    });
}

module.exports = { installUncaughtGuard, isWebstreamTeardownError };
