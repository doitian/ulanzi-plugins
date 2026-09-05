# iany's JS Widgets — Ulanzi Deck Plugin

A collection of JavaScript widgets that share one Ulanzi Deck plugin service.
Includes Clash Traffic and AI Usage, with one shared service.

## Widgets

### Clash Traffic

Shows real-time Clash up/down traffic as a line chart on a Ulanzi Deck key.

- Connects to the Clash external controller WebSocket at `ws://127.0.0.1:9090/traffic`.
- Renders a 12-point line chart of recent up/down speeds directly on the key icon.
- Shows the current up/down speed in human-readable units (`B`, `K`, `M`, `G`, `T`).
- Auto-reconnects with exponential backoff (1s → 30s) when the Clash service is unavailable.
- Falls back to a bundled offline icon when the WebSocket is not reachable.
- Opens a configurable URL when pressed, with separate online and offline targets.

Open the Clash Traffic property inspector to configure:

| Field | Description | Default |
|------|-------------|---------|
| **WebSocket URL** | Clash traffic endpoint | `ws://127.0.0.1:9090/traffic` |
| **API Token** | Clash external controller token (optional) | _empty_ |
| **Online Press URL** | URL opened on key press while connected | _empty_ |
| **Offline Press URL** | URL opened on key press while offline | _empty_ |

## Installation

Copy the entire `me.iany.js.ulanziPlugin` folder into your Ulanzi Studio plugins
directory and restart Ulanzi Studio (or refresh the plugin list in the simulator).
When using [mise](https://mise.jdx.dev/), run `mise run install` from the repository
root to install the collection.

### AI Usage

Shows Claude or Codex **remaining** usage percentage, or Moonshot account balance.
Matches the reference layout: label at top left, provider icon at top right,
large value in the center, and reset duration or balance decimals at the bottom. Add separate keys for the 5-hour and 7-day windows.
Claude also supports `seven_day_fable` and `seven_day_sonnet` when returned
by your plan. Missing limits/accounts show unavailable, never 100%.

Follows the direct API integration in
[ulanzi-studio-niri](https://github.com/doitian/ulanzi-studio-niri/blob/8ff9e2544294e6d4542275d6c737a27ee48b29d8/src/ulanzi_niri/ai_usage.py).
No `aistat` installation is needed. The plugin's Node.js service reads CLI credentials and calls providers over HTTPS.
Ulanzi Studio launches this service from `plugin/main.js`; it starts one shared
HTTP server for all widgets and renders their icons using Canvas. The property
inspectors remain HTML.

1. Install Node.js 18+ and sign in with your provider's CLI (`codex login`, or
   `/login` inside Claude Code). The helper uses the active CLI account only.
2. Run `mise run install` on Windows, then restart Ulanzi Studio. The host starts
   the plugin and its shared server automatically. Installation removes the old
   Windows Startup shortcut and stops the legacy standalone server. No sign-in
   registration or separate manual server launch is required.

   Node.js 18+ and npm are needed to prepare the plugin's pinned `ws` and
   `@napi-rs/canvas` dependencies during installation; the copied package includes
   those dependencies. Ulanzi uses its bundled Node runtime to run the plugin.
   The native Canvas package must match the destination OS and architecture.

   The operating system allocates an available port automatically; the plugin
   passes its address directly to all widgets. No server URL or port settings
   are needed. URLs saved by older plugin versions are ignored.
   Configure credential environment overrides for the Ulanzi Studio process
   and restart it to apply them. `mise run bridge` remains available for
   standalone HTML development (port 18765 by default).
3. Install/reload the plugin and drag **AI Usage** onto a key. Choose the provider,
   usage window, and optionally a custom label.

Set **Press URL** to override the page opened by that key; leave it blank for
the provider default (the `url` setting). Presses work even when usage is offline
and also request a forced usage refresh. Refreshes share the existing
90-second throttle and any in-flight request across all keys. Defaults follow ulanzi-studio-niri:

| Provider | Default press URL |
| --- | --- |
| Claude | `https://claude.ai/new#settings/usage` |
| Codex | `https://chatgpt.com/#settings/Usage` |
| OpenCode Go | `https://opencode.ai/go` |
| Moonshot / Moonshot China | `https://platform.kimi.com/console/account` |

Percentage colors match the reference: green at 60% or more, yellow from 30%,
and red below 30%; missing data is gray. Errors display a red code. Retained
stale readings are gray with a small stale marker. Reset durations use `1h2m`,
`3d4h`, `<1m`, or `now`.

For **OpenCode Go**, select **Rolling (5 hours)**, **Weekly**, or **Monthly**.
Credentials come from the `opencode-go` API entry created by OpenCode `/connect`,
or from the `OPENCODE_GO_API_KEY` user environment variable. The helper calls
`https://opencode.ai/zen/go/v1/usage` and shows the remaining percentage and reset
duration using the same colors as Claude/Codex.

For **Moonshot China (CNY)**, choose **Balance**. It reads the `moonshotai-cn`
API entry from OpenCode, or `MOONSHOT_CN_API_KEY`. It also accepts the existing
`MOONSHOT_API_KEY` override when `MOONSHOT_BASE_URL` explicitly selects
`https://api.moonshot.cn/v1`. This provider always calls the China endpoint and
shows CNY. It never uses the international OpenCode credential. You can display
China and international balances on separate keys.

OpenCode credentials default to `~/.local/share/opencode/auth.json`, respecting
`XDG_DATA_HOME`. Set `ULANZI_OPENCODE_AUTH` to override the exact file location.
After setting persistent user environment variables, restart the shared bridge
(or sign out and back in) for it to inherit them. After OpenCode `/connect`, a
the next automatic refresh reads the updated file without restarting the server.

For **Moonshot (Kimi API)**, select the **Balance** window. Set `MOONSHOT_API_KEY`
in the helper's user environment; it uses USD at `https://api.moonshot.ai/v1`.
Set `MOONSHOT_BASE_URL=https://api.moonshot.cn/v1` for CNY. Alternatively, the
helper reads `moonshotai` / `moonshotai-cn` API credentials from OpenCode's
`$XDG_DATA_HOME/opencode/auth.json` (default `~/.local/share/opencode/auth.json`).
Balances show `¥123` at the center and `.45` below; large values use `¥12K`
and `.345`. CNY is green from ¥70, yellow from ¥36, otherwise red; USD is green
from $12, yellow from $6, otherwise red. Negative balances display as zero.

Credential files default to `~/.codex/auth.json` and
`~/.claude/.credentials.json` (`~` is your user directory, including on Windows).
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` are respected. Set
`ULANZI_CODEX_CREDENTIALS` or `ULANZI_CLAUDE_CREDENTIALS` in the helper environment
to override the exact file path. This version supports file credentials;
OS-keychain-only logins are not supported. Existing account-email settings act
as an optional match against the active Codex account, not an account switch.
Claude does not report an email, so its single active account is used.

The helper calls `https://chatgpt.com/backend-api/wham/usage` and
`https://api.anthropic.com/api/oauth/usage`. Near-expiry access tokens are
refreshed using the CLI refresh token. Rotated credentials are saved by atomic
file replacement, preserving unrelated fields and checking for intervening CLI
changes before replacement. A usage HTTP 401 triggers one token refresh and
retry; HTTP 403 and 429 are not retried immediately. Credentials stay in the
helper and never enter widget settings, local HTTP responses, or logs.

All keys share a 30-minute cache; the widget checks the helper every minute.
Pressing a key opens its usage page in your browser and requests an earlier fetch. Providers
are fetched concurrently, and one provider's failure does not hide the other's
usage. Failed providers are displayed as unavailable with a login, rate-limit,
or API error message. Provider errors are also cached until the next scheduled
refresh. If the helper becomes unreachable, retained readings are
marked **Stale**. **Reset due** means a new reading is needed; it does not assume
the allowance has been restored.

If you see **Helper offline**, restart Ulanzi Studio to relaunch the shared service.
**CLI login required** or **Login expired** means you should sign in again using
the provider CLI, then wait for the next refresh or restart Ulanzi Studio. **No limit data** means that
window was not returned for the selected plan.

Run automated widget, local-helper, and direct-API fixture tests with
`node --test tests/*.test.cjs` from the
repository root. Tests use synthetic credentials and mocked provider responses;
live readings require CLI credentials and Ulanzi Studio.

## Adding another widget

Add its action to `manifest.json`, load its isolated runtime module from
`plugin/node-runtime.cjs` (and `plugin/app.html` for previews), and register its action UUID in `plugin/app.js`. The shared
service owns Ulanzi events and routes each key context to its widget instance.

Widgets that need local filesystem or API access share **one** HTTP server in
`bridge/server.cjs`. Add a route factory to `bridge/` and register its handler in
`createRoutes()`, for example `['/system-stats', createSystemStatsRoute()]`.
Handlers receive the request URL and return JSON data (or a promise for it).
Each factory owns its widget type's cache; the server handles routing, CORS,
request validation, and errors on the same port. Widget modules do not call
`listen()` or create HTTP servers. AI Usage is registered at `/usage`.

Browser clients send `X-Ulanzi-Bridge: 1`. The old `X-Ulanzi-Usage: 1` header is
accepted only for `/usage` for compatibility. `plugin/main.js` starts the shared server once per plugin process and closes it
when the Ulanzi connection closes. Individual widget instances never spawn a
server. For standalone development, use `mise run bridge` (`mise run ai-usage`
is an alias), for the standalone HTML preview.

The official Node SDK is vendored under `libs/node-sdk` with its Apache-2.0
license, from [UlanziTechnology/plugin-common-node](https://github.com/UlanziTechnology/plugin-common-node).
`plugin/node-runtime.cjs` provides Canvas/Image and timers for the existing
widget modules, keeping the HTML preview usable as well.

## Identifiers

- Plugin package: `me.iany.js.ulanziPlugin`
- Plugin UUID: `me.iany.ulanzistudio.js`
- Clash Traffic action UUID: `me.iany.ulanzistudio.js.clashTraffic`
- AI Usage action UUID: `me.iany.ulanzistudio.js.aiUsage`
