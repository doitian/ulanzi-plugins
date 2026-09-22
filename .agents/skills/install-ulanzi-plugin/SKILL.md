---
name: install-ulanzi-plugin
description: Install Ulanzi plugins into the local UlanziDeck Plugins directory via mise, and register a new plugin folder as its own install task
---

Use this skill when the user asks to install, deploy, or register an Ulanzi plugin into the local UlanziDeck Plugins folder.

`mise.toml` is the single source of truth. Each plugin package gets an `install:{shortName}` task, and the top-level `install` task fans out via `depends = ["install:*"]`.

## 1. Adding a Widget Needs No Task Change

This repo keeps **one plugin package hosting many widgets** (`me.iany.js.ulanziPlugin`). Adding a widget — Clash Traffic, AI Usage, Agent Status — changes files *inside* that folder, so `mise run install:js` already covers it. Do not add a task.

A new `install:{shortName}` task is only for a genuinely new `*.ulanziPlugin` folder at the repo root, which is rare. See the `develop-ulanzi-plugin` skill for wiring a widget into the existing package.

## 2. Running

```pwsh
mise run install        # every plugin
mise run install:js     # just me.iany.js.ulanziPlugin
```

Restart UlanziStudio afterwards so the host relaunches the plugin service.

Related tasks:

```pwsh
mise run bridge         # standalone widget server on 18765, for HTML preview
mise run ai-usage       # alias for bridge
```

## 3. Plugins Directory

Resolved at task time from `APPDATA`, defined once as a var:

```toml
[vars]
plugins_dir = '{{env.APPDATA}}\Ulanzi\UlanziDeck\Plugins'
```

Single-quote it at every use site so the rendered Windows path's backslashes survive unescaped.

## 4. The Existing `install:js` Task

The task is a thin delegation; the real work lives in a script, because the plugin ships native dependencies:

```toml
[tasks."install:js"]
description = "Install me.iany.js.ulanziPlugin into UlanziDeck Plugins folder"
shell = "pwsh -NoProfile -Command"
run = '''
& './scripts/install-js.ps1' -PluginsDirectory '{{vars.plugins_dir}}'
'''
```

`scripts/install-js.ps1` does, in order:

1. Resolves `node` and requires **Node 18+**.
2. Probes `require('@napi-rs/canvas'); require('ws')` in the source folder; runs `npm install --omit=dev --ignore-scripts` only if that fails. `node_modules/` is shipped inside the plugin, and `@napi-rs/canvas` is native — it must match the destination OS and architecture.
3. Validates the destination: parent must be exactly the plugins root, leaf exactly the plugin name, and it must not resolve to the source folder.
4. Removes the legacy `iany Ulanzi Widget Bridge.lnk` Startup shortcut (Ulanzi now starts the service itself).
5. Stops **only** `node.exe` processes whose command line points at this plugin's `bridge/server.cjs` or `plugin/main.js` — a running service holds a lock on the native `.node` file and would block the copy.
6. Deletes the destination and re-copies the folder.

Steps 3 and 5 are the ones worth preserving in any new script: an unvalidated destination path plus a recursive delete is how you lose an unrelated directory, and skipping the process stop yields a half-copied plugin with a stale native binary.

## 5. Adding a Task for a New Plugin Package

For a plugin with **no Node dependencies**, inline PowerShell is enough:

```toml
[tasks."install:{shortName}"]
description = "Install {folder}.ulanziPlugin into UlanziDeck Plugins folder"
shell = "pwsh -NoProfile -Command"
run = '''
$dst = Join-Path '{{vars.plugins_dir}}' '{folder}.ulanziPlugin'
if (Test-Path -LiteralPath $dst) { Remove-Item -Recurse -Force -LiteralPath $dst }
New-Item -ItemType Directory -Force -Path '{{vars.plugins_dir}}' | Out-Null
Copy-Item -Recurse -Force '{folder}.ulanziPlugin' $dst
'''
```

For a plugin **with Node or native dependencies**, add `scripts/install-{shortName}.ps1` modelled on `install-js.ps1` and delegate to it as in §4.

Conventions:

- `{shortName}` is the segment immediately before `.ulanziPlugin` — `js` from `me.iany.js.ulanziPlugin`.
- Quote the task header (`"install:foo"`) — TOML needs it for the colon.
- Always remove the destination first so stale files don't linger between installs.
- Keep `shell = "pwsh -NoProfile -Command"`; this repo is Windows-only.
- Leave the aggregate `install` task alone — `depends = ["install:*"]` picks up new tasks automatically.

## 6. Verification Checklist

1. Plugin folder is at the repo root and ends in `.ulanziPlugin`.
2. `mise tasks` lists the new task.
3. `mise run install:{shortName}` exits clean.
4. The folder appears under `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`.
5. After restarting UlanziStudio, the plugin's actions appear and — for Node services — the log shows `Widget bridge listening on http://127.0.0.1:<port>`.
