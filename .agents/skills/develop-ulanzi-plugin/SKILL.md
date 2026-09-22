---
name: develop-ulanzi-plugin
description: Develop an Ulanzi Deck plugin (UlanziStudio) — scaffold, manifest, Node main service, widget modules, shared bridge server, property inspector, icons, events, localization, testing, packaging
---

Develop a plugin for UlanziStudio's programmable macro keypad (Ulanzi Deck) using the official Ulanzi JS Plugin Development Protocol V2.1.2.

Use this skill when the user asks to create, modify, debug, or package an Ulanzi Deck plugin (folders ending in `.ulanziPlugin`).

Reference plugin in this repo: `me.iany.js.ulanziPlugin/` — a single plugin hosting **multiple widgets** (Clash Traffic, AI Usage, Agent Status) behind one Node main service, one shared HTTP bridge, and per-action property inspectors.

## 1. Repo Layout

```
ulanzi-plugins/
├── mise.toml                      # install / bridge tasks
├── scripts/install-js.ps1         # deps + copy into %APPDATA%\Ulanzi\UlanziDeck\Plugins
├── tests/*.test.cjs               # node --test
└── me.iany.js.ulanziPlugin/
    ├── manifest.json
    ├── package.json               # ws + @napi-rs/canvas (pinned)
    ├── node_modules/              # shipped with the plugin (gitignored)
    ├── en.json / zh_CN.json
    ├── README.md
    ├── resources/
    │   ├── icon.svg               # plugin + category icon
    │   └── {action}/              # per-action icons (action-icon.svg, offline.svg, ...)
    ├── libs/
    │   ├── css/uspi.css           # property inspector styles
    │   ├── assets/                # uspi.css control glyphs
    │   ├── js/                    # browser SDK (PI + HTML preview)
    │   └── node-sdk/              # vendored plugin-common-node (Apache-2.0, ESM)
    ├── plugin/
    │   ├── main.js                # CodePath — Node entry, launched by Ulanzi
    │   ├── node-runtime.cjs       # vm sandbox giving widgets Canvas/Image/timers
    │   ├── app.js                 # event router + widget registry
    │   ├── app.html               # browser preview of the same app.js + widgets
    │   └── widgets/{widget}.js    # one module per action, dual-target
    ├── bridge/
    │   ├── server.cjs             # one HTTP server for all widgets
    │   └── {widget}.cjs           # route factories (ai-usage, agent-status, ...)
    └── property-inspector/{action}/
        ├── inspector.html
        └── inspector.js
```

New widgets are added to this plugin rather than spun up as new `.ulanziPlugin` folders — they share the service, the bridge port, and the install task.

## 2. UUID & Naming Rules (strict)

- Folder: `{ns}.{ns}.{plugin}.ulanziPlugin` (e.g. `me.iany.js.ulanziPlugin`)
- Plugin UUID: **exactly 4 dot-segments** — `me.iany.ulanzistudio.js`
- Action UUID: **5+ segments** — `{pluginUUID}.{action}` (e.g. `me.iany.ulanzistudio.js.aiUsage`)
- The browser SDK distinguishes main service from property inspector by counting UUID segments (`libs/js/ulanziApi.js:42`). Get this wrong and runtime breaks silently.

## 3. manifest.json

Top-level: `Author`, `Name`, `Description`, `Icon`, `Version`, `Category`, `CategoryIcon`, `CodePath`, `Type` (`"JavaScript"`), `UUID`, `Actions`, `OS`, `Software.MinVersion`.

`CodePath` is `plugin/main.js` — the Node entry. Ulanzi runs it with its bundled Node runtime and passes `host port lang` as argv.

Per action: `Name`, `Icon`, `PropertyInspectorPath`, `state`, `States` (array of `{Name, Image}`), `Tooltip`, `UUID`, `Controllers`, `Devices`.

Useful flags:

- `PrivateAPI: true` — opt into private APIs (set at top level here).
- `DisableAutomaticStates: true` — stop the host toggling state on press; required when the widget owns its visuals via Canvas.
- `SupportedInMultiActions: false` — exclude from multi-action composition.
- `Devices: []` — all devices. `["D200X"]` whitelist, `["~Dial"]` blacklist. Models: `D200`, `D200H`, `Dial`, `D200X`.
- `Controllers: ["Keypad"]` and/or `["Encoder"]` (rotary dial on D200X/Dial).
- `OS: [{Platform, MinimumVersion}]` for `windows` / `mac`.

For Encoder actions add `Encoder: { layout: "$UA1" }` (icon+text) or `"$UA2"` (text+text), or a custom `layout.json` (canvas 126×140).

## 4. Main Service — Node entry (`plugin/main.js`)

`main.js` is CommonJS and dynamically imports the ESM SDK. It owns the process lifetime: start the bridge **before** accepting widget events, and tear everything down when Ulanzi disconnects.

```js
const { createServer, createRoutes } = require('../bridge/server.cjs');
const { loadWidgets } = require('./node-runtime.cjs');

async function main() {
    const { default: UlanziApi } = await import('../libs/node-sdk/index.js');
    const api = new UlanziApi();
    let runtime;
    const server = createServer({ routes: createRoutes({ getInstances: () => runtime ? runtime.getInstances() : [] }) });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);   // OS picks the port
    });
    const bridgeUrl = 'http://127.0.0.1:' + server.address().port;
    console.info('Widget bridge listening on ' + bridgeUrl);
    api.onClose(stop);
    api.onError(() => {});   // the SDK emits EventEmitter's special error event
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    runtime = loadWidgets(api, bridgeUrl);
}
```

Port is **allocated by the OS and handed to widgets**, not configured. There is no `RandomPort`/`ws-port.js` step.

`api.onError(() => {})` is mandatory — an unhandled `error` event on an EventEmitter throws and kills the plugin.

### node-runtime.cjs

Widget modules are plain browser-style scripts. `loadWidgets` runs them in a `vm` context that supplies the browser globals they expect, so the **same files** serve the Node service and the HTML preview:

- `document.createElement('canvas')` → `@napi-rs/canvas` `createCanvas(144, 144)`
- `Image` → subclass reading from disk via `fs.readFileSync` on `src`
- `WebSocket` (`ws`), `fetch`, `URL`, `AbortController`, `console`
- tracked `setTimeout`/`setInterval` so `dispose()` can clear every outstanding timer
- `ULANZI_BRIDGE_URL`, `$UD`, and `window` aliased to the context itself

Load order matters: widget modules first, then `app.js`. Anything the runtime needs to reach (`getInstances`, `dispose`) is called back into the context with `vm.runInContext`.

## 5. Event Router & Widget Registry (`plugin/app.js`)

One router owns all Ulanzi events and dispatches to per-context widget instances, keyed by action UUID:

```js
const PLUGIN_UUID = 'me.iany.ulanzistudio.js';
const WIDGETS = {
    'me.iany.ulanzistudio.js.clashTraffic': ClashTrafficWidget,
    'me.iany.ulanzistudio.js.aiUsage': AiUsageWidget,
    'me.iany.ulanzistudio.js.agentStatus': AgentStatusWidget
};
const INSTANCES = {};

$UD.connect(PLUGIN_UUID);

$UD.onAdd((jsn) => {
    let instance = INSTANCES[jsn.context];
    if (!instance) {
        const Widget = WIDGETS[getActionUuid(jsn)];
        if (!Widget) return;
        instance = INSTANCES[jsn.context] = new Widget(jsn.context);
    }
    instance.updateSettings((jsn && jsn.param) || {});
    instance.ensureConnected();
});

$UD.onConnected(() => forEachInstance(i => { i.ensureConnected(); i.render(); }));
$UD.onSetActive((jsn) => INSTANCES[jsn.context]?.setActive(jsn.active));
$UD.onRun((jsn) => INSTANCES[jsn.context]?.handlePress());
$UD.onParamFromApp(updateInstance);
$UD.onParamFromPlugin(updateInstance);

$UD.onClear((jsn) => {
    for (const item of jsn.param || []) {   // clear payload is an array
        INSTANCES[item.context]?.destroy();
        delete INSTANCES[item.context];
    }
});
```

`getActionUuid` prefers `jsn.uuid` and falls back to `context.split('___')[0]`.

`onConnected` re-renders existing instances — the host can restart the socket while the plugin process survives.

### Widget module contract

Each `plugin/widgets/{widget}.js` is an IIFE exporting its constructor on `window`, implementing:

| Member | Responsibility |
|---|---|
| `constructor(context)` | allocate canvas, timers; initial `render()` |
| `updateSettings(settings)` | merge, detect meaningful changes, restart connections/timers |
| `ensureConnected()` | idempotent; reconnect only if the socket is missing or not OPEN/CONNECTING |
| `setActive(active)` | `active` arrives as a string — compare `active.toString() === 'true'` |
| `handlePress()` | `$UD.openUrl(url, false, null, this.context)` |
| `render()` | no-op when inactive; push icon via `$UD` |
| `destroy()` | set `destroyed`, close sockets, clear every timer |

Optional `getSnapshot()` exposes instance state to bridge routes (see `/usage/fetch`).

## 6. Shared Bridge Server (`bridge/`)

Widgets needing filesystem, credentials, or outbound HTTPS use **one** server. Never call `listen()` from a widget.

Add a route factory in `bridge/{widget}.cjs` and register it in `createRoutes()`:

```js
function createRoutes({ getInstances = () => [], usageRoute = createUsageRoute(), agentsRoute = createAgentsRoute() } = {}) {
    return new Map([
        ['/health', async () => ({ service: 'me.iany.ulanzistudio.js.bridge' })],
        ['/usage/fetch', () => ({ instances: getInstances() })],
        ['/usage', usageRoute],
        ['/usage/refresh', url => usageRoute(url, true)],
        ['/agents', agentsRoute]
    ]);
}
```

Handlers receive the parsed `URL` and return JSON (or a promise). The server owns routing, CORS, validation, and errors. Each factory owns its own cache.

Hardening the server already applies, and new routes inherit it:

- reject unless `Host` is `127.0.0.1:{port}`; reject non-`null` cross origins (HTML plugins have opaque `file` origins)
- require `X-Ulanzi-Bridge: 1`
- method is `GET` except `POST` for explicit refresh routes; `OPTIONS` returns 204
- handler throw → 503 with a generic message; secrets never reach responses or logs

Clients call `(window.ULANZI_BRIDGE_URL || 'http://127.0.0.1:18765') + '/route'` — the fallback port is the standalone `mise run bridge` server used for HTML preview.

## 7. Property Inspector

`property-inspector/{action}/inspector.html` links `libs/css/uspi.css`, wraps the form in `.uspi-wrapper hidden`, then loads the five browser SDK scripts before `inspector.js`.

```js
let settings = {};
let form;

$UD.connect();   // PI takes its uuid from the query string — pass no argument

$UD.onConnected(() => {
    form = document.querySelector('#property-inspector');
    applySettings();
    document.querySelector('.uspi-wrapper').classList.remove('hidden');
    if (form.dataset.bound) return;
    form.dataset.bound = 'true';
    form.addEventListener('input', Utils.debounce(() => {
        settings = Utils.getFormValue(form);
        $UD.sendParamFromPlugin(settings);
    }));
});

function receive(jsn) {
    if (!jsn || !jsn.param) return;
    settings = Object.assign({}, jsn.param);
    applySettings();
}
$UD.onAdd(receive);
$UD.onParamFromApp(receive);
```

Conventions:

- Keep defaults in `applySettings` via `Object.assign({...defaults}, settings)` so a fresh key renders populated.
- `onConnected` can fire more than once — guard listener binding (`form.dataset.bound`).
- `name` attributes map directly to settings keys.
- Strip settings the plugin no longer honors when receiving (e.g. a retired `helperUrl`).
- Dependent dropdowns: disable invalid `<option>`s and coerce the value on `input` (see the AI Usage provider→window map).
- Send via `sendParamFromPlugin`, not `setSettings` — the host persists and echoes back through `paramfromapp`.

## 8. Setting Icons

The host doesn't auto-render Canvas. Push from the main service:

| API | Use |
|---|---|
| `$UD.setStateIcon(context, stateIndex, text?)` | Switch to a manifest `States` entry |
| `$UD.setPathIcon(context, 'resources/x/y.svg', text?)` | Local file, path relative to plugin root |
| `$UD.setBaseDataIcon(context, canvas.toDataURL('image/png'), text?)` | Dynamic Canvas |
| `$UD.setGifPathIcon(context, 'anim.gif', text?)` / `setGifDataIcon` | Animated |

Canvas icons are **144×144** (device key resolution). Return early from `render()` when inactive — the host ignores updates for inactive keys.

## 9. Settings Persistence

- `setSettings(data, context)` / `getSettings(context)` — per-action; **only saves while active**.
- `setGlobalSettings(data)` / `getGlobalSettings()` — plugin-wide.
- Prefer the `sendParamFromPlugin` ↔ `onParamFromApp` flow; it is the host-managed path.

## 10. Event Cheat Sheet

Lifecycle: `onConnected`, `onAdd`, `onSetActive`, `onClear` (param is an array of `{context, ...}`).

Keypad: `onRun` (debounced single press, primary trigger), `onKeyDown`, `onKeyUp`.

Encoder: `onDialDown`, `onDialUp`, `onDialRotate` (`message.rotateEvent` ∈ `left|right|hold-left|hold-right`), plus `onDialRotate{Left,Right,HoldLeft,HoldRight}`.

Node service only: `onClose`, `onError`.

Cross-page (pass-through, not persisted):
- Main → PI: `$UD.sendToPropertyInspector(data, context)` → PI `onSendToPropertyInspector`
- PI → Main: `$UD.sendToPlugin(data)` → Main `onSendToPlugin`

System: `toast(msg)`, `hotkey('Ctrl+C')`, `openUrl(url, local, param, context)`, `openView(html, w, h)`, `selectFileDialog(filter)`, `selectFolderDialog()`, `logMessage(msg, level)`, `showAlert(context)`.

`context` decoding: `$UD.decodeContext(ctx) → { uuid, key, actionid }`. Format: `uuid___key___actionid`.

## 11. Localization

Place `{lang}.json` in the plugin root. Supported: `en`, `zh_CN`, `zh_HK`, `ja_JP`, `de_DE`, `ko_KR`, `pt_PT`, `es_ES`.

```json
{
  "Name": "iany's JS Widgets",
  "Description": "...",
  "Actions": [{ "Name": "AI Usage", "Tooltip": "..." }],
  "Localization": { "WebSocket URL": "WebSocket 地址" }
}
```

`Actions` is positional — it must match `manifest.json` order. Every `data-localize` string in every inspector needs a `Localization` entry, including `<option>` labels.

In PI HTML use `data-localize` (translates `textContent`, `placeholder`, `title`, `label`); the SDK runs it on `.uspi-wrapper` after connect. In JS use `$UD.t('key')`.

## 12. Long-Running Connections

Exponential backoff plus a staleness watchdog — `readyState` lags a silently dropped TCP connection (host restarts, sleep/resume):

```js
Widget.prototype.scheduleReconnect = function () {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null;
        this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
        this.connectWs();
    }, this.reconnectDelay);
};

Widget.prototype.checkStale = function () {
    if (this.destroyed || !this.connected || !this.lastMessageAt) return;
    if (Date.now() - this.lastMessageAt < STALE_TIMEOUT_MS) return;
    this.connectWs();
};
```

Null out `onopen`/`onmessage`/`onerror`/`onclose` before `close()` so teardown doesn't recurse into reconnect. Reset `reconnectDelay` on a successful open and in `ensureConnected`.

## 13. Testing

```bash
node --test tests/*.test.cjs        # from the repo root
```

`tests/plugin-lifecycle.test.cjs` spawns `plugin/main.js` against a stub `WebSocketServer`, scrapes the allocated port from stdout, and asserts clean exit. Point `ULANZI_*_CREDENTIALS` at missing files and blank the API-key env vars so tests never touch real accounts; mock provider responses.

**Desktop debug flags:**

| Flag | Purpose |
|---|---|
| `--log` + `--logLevel` | File logs |
| `--webRemoteDebug` | HTML plugins debuggable at `http://localhost:9292` |
| `--nodeRemoteDebug` | Node plugins via `chrome://inspect` (add `"Inspect": "--inspect=127.0.0.1:9201"` to the manifest) |

Windows: append flags to the shortcut Target. macOS: `open /Applications/Ulanzi\ Studio.app --args --webRemoteDebug` (`open` may break Accessibility permissions; prefer the binary directly if hotkeys misbehave).

**HTML preview:** `mise run bridge` starts the standalone server on 18765, then open `plugin/app.html`. The external UlanziDeckSimulator also works but can't open local files via `openUrl`/`openView` and won't launch a Node main service for you.

## 14. Installation / Packaging

`mise run install` → `scripts/install-js.ps1`, which:

1. requires Node 18+ on PATH,
2. runs `npm install --omit=dev --ignore-scripts` in the plugin folder when `@napi-rs/canvas`/`ws` aren't resolvable,
3. kills only this plugin's `node.exe` processes so native `.node` files can be replaced,
4. removes and re-copies the folder into `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`.

`node_modules/` ships with the plugin; `@napi-rs/canvas` is native, so it must match the destination OS/arch. Restart UlanziStudio afterwards.

See the `install-ulanzi-plugin` skill for registering a new plugin folder as its own mise task.

## 15. Common Pitfalls

1. **Wrong UUID segment count.** 4 = main service, 5+ = action (`libs/js/ulanziApi.js:42`).
2. **`onClear` payload is an array.** Iterate `jsn.param`; there is no `jsn.context`.
3. **`jsn.active` is a string.** `active.toString() === 'true'`.
4. **Missing `api.onError`** on the Node service crashes the plugin on the first socket error.
5. **Widget modules must not create servers or call `listen()`** — register a bridge route instead.
6. **New widget = three registrations:** `manifest.json` action, the module in `node-runtime.cjs`'s load list *and* `app.html`, and the action UUID in `app.js`'s `WIDGETS`.
7. **Settings dropped while inactive.** `setSettings` is a no-op when the action isn't active.
8. **Path icons resolve from the plugin root**, not the HTML file location.
9. **PI must load the SDK before the script calling `$UD.connect()`**, and must call `connect()` with no argument.
10. **`onConnected` can fire repeatedly** — make instance setup and PI listener binding idempotent.
11. **`en.json` `Actions` is positional**; reordering manifest actions silently mislabels them.

## 16. Adding a Widget — Checklist

1. `manifest.json`: new action with its UUID, `PropertyInspectorPath`, `States`, `DisableAutomaticStates`.
2. `resources/{widget}/`: `action-icon.svg` plus any state icons.
3. `plugin/widgets/{widget}.js`: IIFE implementing the contract in §5, exported on `window`.
4. `plugin/node-runtime.cjs`: add the file to the load list (before `app.js`).
5. `plugin/app.html`: add the `<script>` for preview parity.
6. `plugin/app.js`: map the action UUID to the constructor in `WIDGETS`.
7. `bridge/{widget}.cjs` + `createRoutes()` entry, if it needs host access.
8. `property-inspector/{widget}/inspector.{html,js}`.
9. `en.json` / `zh_CN.json`: `Actions` entry in manifest order + every `data-localize` string.
10. `tests/{widget}.test.cjs`, and README docs.
