# iany's JS Widgets — Ulanzi Deck Plugin

A collection of JavaScript widgets that share one Ulanzi Deck plugin service.
Includes Clash Traffic, AI Usage, and Agent Status, with one shared service.

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

Shows Claude, Codex, xAI (Grok), or Kimi Code **remaining** usage percentage, or Moonshot account balance.
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

1. Install Node.js 18+ and sign in with your provider's CLI (`codex login`,
   `grok login`, or `/login` inside Claude Code or Kimi CLI). The helper uses the active CLI account only.
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
| Kimi Code | `https://www.kimi.com/code/console` |
| xAI (Grok) | `https://grok.com/?_s=usage` |
| Moonshot / Moonshot China | `https://platform.kimi.com/console/account` |

Percentage colors match the reference: green at 60% or more, yellow from 30%,
and red below 30%; missing data is gray. Errors display a red code. Retained
stale readings are gray with a small stale marker. Reset durations use `1h2m`,
`3d4h`, `<1m`, or `now`.

For **xAI (Grok)**, select **Weekly**. Credentials come from `grok login` in
`~/.grok/auth.json` (`GROK_HOME` is respected). Set `ULANZI_GROK_CREDENTIALS`
to override the exact file path. The helper calls
`https://cli-chat-proxy.grok.com/v1/billing?format=credits` and shows the remaining
percentage and reset time for the current SuperGrok week. Near-expiry access tokens
are refreshed with the Grok CLI refresh token.

For **Kimi Code**, select **5 hours** or **Monthly**. The helper calls
`https://api.kimi.com/coding/v1/usages` (override with `KIMI_CODE_BASE_URL`) and shows
the remaining percentage and reset time of the plan's 5-hour and monthly quotas plus
any windowed limits returned for it. Credentials are resolved in order:

1. Kimi CLI OAuth tokens from `/login` inside Kimi CLI, stored in
   `~/.kimi/credentials/kimi-code.json` (`KIMI_SHARE_DIR` is respected; set
   `ULANZI_KIMI_CODE_CREDENTIALS` to override the exact file path).
2. pi's `kimi-coding` OAuth entry in `~/.pi/agent/auth.json` (`PI_CODING_AGENT_DIR`
   is respected; set `ULANZI_PI_AUTH` to override the exact file path).
3. A `kimi-code-plan-cn` or `kimi-code-plan-global` API key saved by OpenCode
   `/connect`. The global entry calls `https://api.kimi.ai/coding/v1` instead.

Near-expiry OAuth tokens are refreshed against `https://auth.kimi.com/api/oauth/token`
(sending the `~/.kimi/device_id` header when present for Kimi CLI credentials) and
written back atomically, preserving unrelated entries in the same file. API-key
credentials cannot be refreshed; rotate them in OpenCode when they expire.

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

Credential files default to `~/.codex/auth.json`,
`~/.claude/.credentials.json`, `~/.grok/auth.json`, and `~/.kimi/credentials/kimi-code.json` (`~` is your user directory, including on Windows).
`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, `GROK_HOME`, and `KIMI_SHARE_DIR` are respected. Set
`ULANZI_CODEX_CREDENTIALS`, `ULANZI_CLAUDE_CREDENTIALS`, `ULANZI_GROK_CREDENTIALS`, or `ULANZI_KIMI_CODE_CREDENTIALS` in the helper environment
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

### Agent Status

Shows how many coding agent sessions are in each state, as tracked by
agent-berth. It mirrors the badges of `tc002 watch agents` in ulanzi-tc002 on a
144×144 key: the label at top left, the agent icon at top right, the most urgent
status as a large glyph next to its session count across the middle, and a bar
along the bottom with one segment per status.

`agent-berth` owns hooks, session tracking, and pruning; this widget only reads
its snapshots. Run `agent-berth setup` once to install the provider hooks. The
plugin's shared service runs `agent-berth stats --json`, so the executable must
be on the Ulanzi Studio process PATH; set `ULANZI_AGENT_BERTH` to its exact path
otherwise, and restart Ulanzi Studio to apply it.

Open the Agent Status property inspector to configure:

| Field | Description | Default |
| --- | --- | --- |
| **Agent** | Which agent to show, or **All agents** to sum every provider | All agents |
| **Label** | Overrides the name shown at the top left | _empty_ |
| **Press URL** | URL opened on key press; blank only refreshes the counts | _empty_ |

**All agents** also sums providers this plugin has no icon for, so a new
agent-berth provider is counted before the widget knows its name.

The center number is the count of the highest-priority non-empty status
(**waiting > running > done > idle**) and takes that status's color: waiting is
orange, running yellow, done blue, and idle green. The glyph beside it names
that status without a caption: a bang for waiting, a play triangle for running,
a check for done, and a pause for idle. The bottom bar lights the segment of
every status that has sessions, in the same order and colors. A selected agent
with no sessions shows a green pause and `0`.

| agent-berth status | Meaning |
| --- | --- |
| `waiting` | Permission, question, or elicitation needs input |
| `running` | Running a turn or known background work |
| `done` | The tracked turn finished |
| `idle` | Discovered presence without a running turn |

All keys share one reading, refreshed every two seconds; pressing a key requests
an immediate one. A failure keeps the last counts and marks them **stale** in
gray. When no reading has arrived yet, `n/a` **NO CLI** means `agent-berth` was
not found, `Err` **AGENT-BERTH** means it failed or returned an unusable
payload, `TO` means it did not answer within five seconds, and `Err` **HELPER**
means the plugin's shared service is unreachable — restart Ulanzi Studio.

## Configured AI Usage instances API

`GET /usage/fetch` on the running plugin's bridge returns the AI Usage buttons
reported by Ulanzi, including inactive buttons. Cleared buttons are removed.
This does not enumerate saved profiles that Ulanzi has not loaded. The standalone
`mise run bridge` server returns an empty list because it has no Ulanzi instances.

Use the port from the startup log (`Widget bridge listening on http://127.0.0.1:<port>`):

```powershell
Invoke-RestMethod "http://127.0.0.1:<port>/usage/fetch" -Headers @{ 'X-Ulanzi-Bridge' = '1' } |
    ConvertTo-Json -Depth 10
```

Example response:

```json
{
  "instances": [
    {
      "context": "me.iany.ulanzistudio.js.aiUsage___key1___action1",
      "active": true,
      "settings": { "provider": "codex", "limit": "five_hour", "account": "", "label": "" },
      "usage": { "remaining_percent": 73, "resets_at": "2026-09-18T12:00:00.000Z" },
      "fetchedAt": 1789732800000,
      "stale": false,
      "error": null
    }
  ]
}
```

The endpoint reads the same cached usage and account/window selection as each
button; calling it does not trigger a provider request. Settings include effective
provider/window defaults, the account filter (blank selects the active account),
and the custom label. Balance windows return `remaining_amount` and `currency`
instead of percentage/reset fields. Unavailable readings return `usage.error`,
including `Loading...` before the first fetch. `fetchedAt` is Unix milliseconds
or `null` before data arrives; unknown reset times are `null`. `stale` indicates
a helper error or data older than 35 minutes. The top-level per-instance `error`
reports a helper failure while any previous reading remains in `usage`.
An empty configuration returns `{ "instances": [] }`.

### Refresh AI usage

`POST /usage/refresh` requests fresh usage from all providers and returns the same
sanitized `{ "providers": { ... }, "fetchedAt": ... }` response as `GET /usage`.
No request body is needed. It bypasses the 30-minute cache while respecting the
shared 90-second throttle: requests within that interval return the cached data
or the previous helper error. Concurrent refreshes share one in-flight request.
Helper failures return HTTP 503; individual provider errors appear in `providers`.
Buttons and `/usage/fetch` pick up the result on the next widget poll (within
one minute). The existing `GET /usage?refresh=1` remains supported.

```powershell
Invoke-RestMethod "http://127.0.0.1:<port>/usage/refresh" -Method Post -Headers @{ 'X-Ulanzi-Bridge' = '1' } |
    ConvertTo-Json -Depth 10
```

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
`listen()` or create HTTP servers. AI Usage is registered at `/usage` and Agent
Status at `/agents`.

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
- Agent Status action UUID: `me.iany.ulanzistudio.js.agentStatus`
