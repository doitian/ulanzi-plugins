---
name: install-ulanzi-plugin
description: Register an Ulanzi plugin in mise.toml as an install task and run it to deploy the plugin folder into the UlanziDeck Plugins directory
---

Use this skill when the user asks to install, deploy, or register an Ulanzi plugin into the local UlanziDeck Plugins folder via mise.

The repo's `mise.toml` is the single source of truth for installation. Each plugin gets its own `install:{shortName}` task, and a top-level `install` task fans out via `depends = ["install:*"]`.

## 1. Plugins Directory

Resolved at task time from `APPDATA`:

```
{{env.APPDATA}}\Ulanzi\UlanziDeck\Plugins
```

Defined once as a var:

```toml
[vars]
plugins_dir = '{{env.APPDATA}}\Ulanzi\UlanziDeck\Plugins'
```

## 2. Adding an Install Task

For a plugin folder `{author}.{plugin}.ulanziPlugin/` at the repo root, append a task to `mise.toml`:

```toml
[tasks."install:{shortName}"]
description = "Install {author}.{plugin}.ulanziPlugin into UlanziDeck Plugins folder"
shell = "pwsh -NoProfile -Command"
run = '''
$dst = Join-Path '{{vars.plugins_dir}}' '{author}.{plugin}.ulanziPlugin'
if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
New-Item -ItemType Directory -Force -Path '{{vars.plugins_dir}}' | Out-Null
Copy-Item -Recurse -Force '{author}.{plugin}.ulanziPlugin' $dst
'''
```

Conventions:

- `{shortName}` is the final segment of the plugin folder (camelCase), e.g. `clashTraffic` from `me.iany.clashTraffic.ulanziPlugin`.
- Quote the task header (`"install:foo"`) — the colon needs it in TOML.
- Always remove the destination first so stale files don't linger between installs.
- Use single-quoted PowerShell string literals around `'{{vars.plugins_dir}}'` so the rendered Windows path with backslashes survives unescaped.
- Keep `shell = "pwsh -NoProfile -Command"` — Windows-only repo, matches the existing pattern.

The aggregate `install` task already exists and picks up new tasks automatically:

```toml
[tasks.install]
description = "Install all plugins into UlanziDeck Plugins folder"
depends = ["install:*"]
```

Do not edit it when adding a new plugin.

## 3. Running

```pwsh
mise run install:{shortName}   # one plugin
mise run install                # all plugins
```

Restart UlanziStudio (or refresh the simulator) after install for the host to pick up changes.

## 4. Verification Checklist

1. Plugin folder exists at the repo root and ends in `.ulanziPlugin`.
2. New `[tasks."install:{shortName}"]` block added to `mise.toml`.
3. `mise tasks` lists the new task.
4. After `mise run install:{shortName}`, the folder appears under `%APPDATA%\Ulanzi\UlanziDeck\Plugins\`.
