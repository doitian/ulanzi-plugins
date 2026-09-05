const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas, Image } = require('@napi-rs/canvas');
const WebSocket = require('ws');

// Keep the widget rendering modules usable in both Node and the HTML preview.
function loadWidgets(api, bridgeUrl) {
    class LocalImage extends Image {
        set src(value) { super.src = fs.readFileSync(path.resolve(__dirname, value)); }
    }
    const timers = new Set();
    const environment = {
        ULANZI_BRIDGE_URL: bridgeUrl, $UD: api, WebSocket, Image: LocalImage, fetch, URL, AbortController, console,
        setTimeout(fn, ms) { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.add(timer); return timer; },
        clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
        setInterval(fn, ms) { const timer = setInterval(fn, ms); timers.add(timer); return timer; },
        clearInterval(timer) { clearInterval(timer); timers.delete(timer); },
        document: { createElement(type) {
            if (type !== 'canvas') throw new Error('Unsupported widget element: ' + type);
            return createCanvas(144, 144);
        } }
    };
    environment.window = environment;
    const context = vm.createContext(environment);
    for (const file of ['widgets/clash-traffic.js', 'widgets/ai-usage.js', 'app.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context, { filename: file });
    }
    return () => {
        vm.runInContext('forEachInstance(instance => instance.destroy())', context);
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
    };
}
module.exports = { loadWidgets };
