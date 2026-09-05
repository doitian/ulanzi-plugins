---
name: develop-ulanzi-plugin
description: Develop an Ulanzi Deck plugin (UlanziStudio) — scaffold, manifest, main service, property inspector, icons, events, localization, packaging
---

Develop a plugin for UlanziStudio's programmable macro keypad (Ulanzi Deck) using the official Ulanzi JS Plugin Development Protocol V2.1.2.

Use this skill when the user asks to create, modify, debug, or package an Ulanzi Deck plugin (folders ending in `.ulanziPlugin`).

Reference plugin in this repo: `me.iany.clashTraffic.ulanziPlugin/` — a complete working example (HTML main service + Canvas-rendered key icon + WebSocket data source + property inspector + i18n + per-state offline icon).

## 1. Plugin Layout

```
{author}.{plugin}.ulanziPlugin/
├── manifest.json              # required
├── en.json / zh_CN.json       # optional localization
├── README.md
├── resources/                 # icons (svg/png/jpg), gifs
├── libs/                      # SDK (copy from common-html or common-node)
│   ├── css/uspi.css           # property inspector styles
│   └── js/{constants,eventEmitter,timers,utils,ulanziApi}.js
├── plugin/                    # main service
│   ├── app.html               # HTML main service entry
│   └── app.js                 # logic (loaded by app.html)
└── property-inspector/
    └── {action}/
        ├── inspector.html
        └── inspector.js
```

## 2. UUID & Naming Rules (strict)

- Folder: `{namespace}.{plugin}.ulanziPlugin` (e.g. `me.iany.clashTraffic.ulanziPlugin`)
- Plugin UUID: **exactly 4 dot-segments** — `{ns1}.{ns2}.{ns3}.{plugin}` (e.g. `me.iany.ulanzistudio.clashTraffic`)
- Action UUID: **5+ segments** — `{pluginUUID}.{action}` (e.g. `me.iany.ulanzistudio.clashTraffic.traffic`)
- The SDK distinguishes main service vs. property inspector by counting UUID segments (`ulanziApi.js:42`). Get this wrong and runtime breaks silently.

## 3. manifest.json

Required top-level fields: `Author`, `Name`, `Icon`, `Version`, `CodePath`, `Type` (always `"JavaScript"`), `UUID`, `Actions`.

Required action fields: `Name`, `Icon`, `States` (array, each `{Name, Image}`), `UUID`, `Controllers`.

Useful flags:

- `PrivateAPI: true` — opt into private APIs.
- `DisableAutomaticStates: true` — prevent host from auto-toggling state on press; use when plugin owns state visualization (e.g. dynamic icons via Canvas).
- `SupportedInMultiActions: false` — exclude from multi-action composition.
- `Devices: []` — all devices. `["D200X"]` whitelist. `["~Dial"]` blacklist Dial. Models: `D200`, `D200H`, `Dial`, `D200X`.
- `Controllers: ["Keypad"]` and/or `["Encoder"]` (rotary dial on D200X/Dial).
- `OS`, `Software.MinVersion`, `ApplicationsToMonitor`, `Profiles`, `InstallToDepsApp` — see `references/manifest.md` if needed.

For Encoder actions, add `Encoder: { layout: "$UA1" }` (icon+text) or `"$UA2"` (text+text), or a custom `layout.json` (canvas 126×140).

## 4. Main Service — HTML (recommended for UI/Canvas-heavy plugins)

`plugin/app.html` loads the SDK in order, then your script:

```html
<script src="../libs/js/constants.js"></script>
<script src="../libs/js/eventEmitter.js"></script>
<script src="../libs/js/timers.js"></script>
<script src="../libs/js/utils.js"></script>
<script src="../libs/js/ulanziApi.js"></script>
<script src="./app.js"></script>
```

`plugin/app.js` skeleton:

```js
const PLUGIN_UUID = 'me.iany.ulanzistudio.myplugin';

$UD.connect(PLUGIN_UUID);

const INSTANCES = {}; // keyed by context

$UD.onConnected(() => {});

$UD.onAdd((jsn) => {
  // jsn.context is unique per key instance
  if (!INSTANCES[jsn.context]) INSTANCES[jsn.context] = createInstance(jsn.context);
  if (jsn.param) INSTANCES[jsn.context].update(jsn.param);
});

$UD.onRun((jsn) => INSTANCES[jsn.context]?.press());
$UD.onSetActive((jsn) => INSTANCES[jsn.context]?.setActive(jsn.active));
$UD.onParamFromApp((jsn) => jsn.param && INSTANCES[jsn.context]?.update(jsn.param));
$UD.onParamFromPlugin((jsn) => jsn.param && INSTANCES[jsn.context]?.update(jsn.param));

$UD.onClear((jsn) => {
  // NOTE: clear payload is array; context lives on each item
  for (const item of jsn.param || []) {
    INSTANCES[item.context]?.destroy();
    delete INSTANCES[item.context];
  }
});
```

## 5. Main Service — Node.js (for system/file/network access beyond browser sandbox)

```js
import UlanziApi, { Utils, RandomPort } from './plugin-common-node/index.js';
const $UD = new UlanziApi();
new RandomPort().getPort(); // writes ws-port.js so PI can find the port
$UD.connect('me.iany.ulanzistudio.myplugin');
```

Same event API as HTML. Set `manifest.json` `CodePath` to `plugin/app.js`. For debugging add `"Inspect": "--inspect=127.0.0.1:9201"` (unique port per plugin) and launch host with `--nodeRemoteDebug`.

## 6. Property Inspector

`property-inspector/{action}/inspector.html`:

```html
<link rel="stylesheet" href="../../libs/css/uspi.css">
<div class="uspi-wrapper hidden">
  <form id="property-inspector">
    <div class="uspi-item">
      <div class="uspi-item-label" data-localize>WebSocket URL</div>
      <input type="text" class="uspi-item-value" name="wsUrl" placeholder="ws://...">
    </div>
  </form>
</div>
<script src="../../libs/js/constants.js"></script>
<!-- ...same SDK includes as app.html... -->
<script src="./inspector.js"></script>
```

`inspector.js`:

```js
let form;
$UD.connect(); // PI gets uuid from query string
$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  form.addEventListener('input', Utils.debounce(() => {
    $UD.sendParamFromPlugin(Utils.getFormValue(form));
  }));
});
$UD.onAdd((jsn) => jsn.param && Utils.setFormValue(jsn.param, form));
$UD.onParamFromApp((jsn) => jsn.param && Utils.setFormValue(jsn.param, form));
```

Conventions:

- Wrap content in `.uspi-wrapper` (auto i18n + styling). Initially hidden, revealed `onConnected` to avoid FOUC.
- `name` attributes on inputs map directly to settings keys.
- Use `Utils.debounce` on `input` to avoid spamming the host.
- Send via `sendParamFromPlugin` (not `setSettings`) — host persists settings only when active and propagates back through `paramfromapp`.

## 7. Setting Icons

The host doesn't auto-render Canvas. From the main service, push icons via `$UD`:

| API | Use |
|---|---|
| `$UD.setStateIcon(context, stateIndex, text?)` | Switch to a state from manifest `States` |
| `$UD.setPathIcon(context, 'resources/x.svg', text?)` | Local file (paths relative to plugin root) |
| `$UD.setBaseDataIcon(context, 'data:image/png;base64,...', text?)` | Dynamic Canvas → `canvas.toDataURL('image/png')` |
| `$UD.setGifPathIcon(context, 'anim.gif', text?)` / `setGifDataIcon` | Animated |

For Canvas-rendered icons use **144×144** (matches device key resolution). Render only when `active`; the host ignores updates for inactive keys but you'll waste CPU.

## 8. Settings Persistence

- `setSettings(data, context)` / `getSettings(context)` — per-action; **only saves while active**.
- `setGlobalSettings(data)` / `getGlobalSettings()` — plugin-wide.
- Receive via `onDidReceiveSettings` / `onDidReceiveGlobalSettings`.
- The PI flow above (`sendParamFromPlugin` ↔ `onParamFromApp`) is the host-managed persistence path and is preferred over manual `setSettings` from the PI.

## 9. Event Cheat Sheet

Lifecycle: `onConnected`, `onAdd`, `onSetActive`, `onClear` (param is array of `{context, ...}`).

Keypad: `onRun` (debounced single-press, primary trigger), `onKeyDown`, `onKeyUp`.

Encoder: `onDialDown`, `onDialUp`, `onDialRotate` (`message.rotateEvent` ∈ `left|right|hold-left|hold-right`), plus `onDialRotate{Left,Right,HoldLeft,HoldRight}`.

Cross-page (pass-through, not persisted by host):
- Main → PI: `$UD.sendToPropertyInspector(data, context)` → PI `onSendToPropertyInspector`
- PI → Main: `$UD.sendToPlugin(data)` → Main `onSendToPlugin`

System: `toast(msg)`, `hotkey('Ctrl+C')`, `openUrl(url)`, `openView(html, w, h)`, `selectFileDialog(filter)`, `selectFolderDialog()`, `logMessage(msg, level)`, `showAlert(context)`.

`context` decoding: `$UD.decodeContext(ctx) → { uuid, key, actionid }`. Format: `uuid___key___actionid`.

## 10. Localization

Place `{lang}.json` in plugin root. Supported: `en`, `zh_CN`, `zh_HK`, `ja_JP`, `de_DE`, `ko_KR`, `pt_PT`, `es_ES`.

```json
{
  "Name": "My Plugin",
  "Description": "...",
  "Actions": [{ "Name": "...", "Tooltip": "..." }],
  "Localization": { "WebSocket URL": "WebSocket 地址" }
}
```

In PI HTML use `data-localize` (translates `textContent`, `placeholder`, `title`, `label`). The SDK auto-runs on `.uspi-wrapper`/`.udpi-wrapper` after connect. In JS use `$UD.t('key')`.

## 11. Reconnection & Long-Running Connections

When opening external sockets (e.g. WebSocket data sources), implement exponential backoff and tear down on `onClear`. Pattern from the reference plugin:

```js
scheduleReconnect() {
  if (this.destroyed || this.reconnectTimer) return;
  this.reconnectTimer = setTimeout(() => {
    this.reconnectTimer = null;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    this.connect();
  }, this.reconnectDelay);
}
```

Always null out socket handlers before `close()` to avoid recursive reconnects.

## 12. Testing

**Simulator** (no host app needed):

```bash
cd UlanziDeckSimulator && npm install && npm start
# copy plugin folder into UlanziDeckSimulator/plugins/
# open http://127.0.0.1:39069 → click "Refresh Plugin List"
```

Limitations: `openUrl`/`openView` can't open local files; Node.js main services must be started manually (`node plugin/app.js`); right-click a key to manually fire events.

**Desktop debug flags:**

| Flag | Purpose |
|---|---|
| `--log` + `--logLevel` | File logs |
| `--webRemoteDebug` | HTML plugins debuggable at `http://localhost:9292` |
| `--nodeRemoteDebug` | Node plugins via `chrome://inspect` |

Windows: append flags to shortcut Target. macOS: `open /Applications/Ulanzi\ Studio.app --args --webRemoteDebug` (note: `open` may break Accessibility permissions; prefer running the binary directly if hotkeys misbehave).

## 13. Installation / Packaging

Copy the `*.ulanziPlugin/` folder into the host's plugins directory and restart UlanziStudio (or refresh in the simulator). No build step required for plain JS/HTML plugins.

## 14. Common Pitfalls

1. **Wrong UUID segment count.** 4 = main service, 5+ = action. The SDK silently picks the wrong role otherwise (`ulanziApi.js:42`).
2. **Settings dropped while inactive.** `setSettings` is a no-op when the action isn't active; rely on the PI ↔ host ↔ main flow.
3. **`onClear` payload is an array.** `jsn.param` is `[{context, ...}, ...]` — iterate, don't read `jsn.context`.
4. **Canvas icons must be base64-encoded.** `canvas.toDataURL('image/png')` then `setBaseDataIcon`.
5. **Path icons resolve from plugin root**, not the HTML file location. `resources/icon.svg` works from anywhere.
6. **PI script must include the SDK before the script that calls `$UD.connect()`** — order matters.
7. **Don't call `$UD.connect(uuid)` in the PI** — pass no argument so it picks UUID from the query string the host injects.

## 15. Reference Plugin Walkthrough

`me.iany.clashTraffic.ulanziPlugin/` demonstrates:

- HTML main service with per-context state objects (`plugin/app.js:67`).
- Canvas line chart drawn each WebSocket message, pushed via `setBaseDataIcon` (`plugin/app.js:301`).
- Fallback to a static SVG via `setPathIcon` when the data source is offline (`plugin/app.js:213`).
- Settings sync via `sendParamFromPlugin` ↔ `onParamFromApp` (`property-inspector/traffic/inspector.js:18`, `plugin/app.js:53`).
- Per-state press action (different URL when online vs. offline) using `$UD.openUrl` (`plugin/app.js:186`).
- Exponential reconnect with full teardown in `onClear` (`plugin/app.js:175`, `plugin/app.js:195`).
- i18n via `data-localize` plus `en.json` / `zh_CN.json`.

When asked to add a new action or new plugin, mirror this structure unless requirements demand Node.js (filesystem, native modules, raw TCP, etc.).
