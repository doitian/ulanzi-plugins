# Ulanzi Deck Plugins

Plugins for [Ulanzi Studio](https://www.ulanzi.com/) (Ulanzi Deck). The repository
currently ships one JavaScript plugin, **iany's JS Widgets**, which hosts several
widgets behind a single shared Node service.

| Widget | What it shows |
| --- | --- |
| **Clash Traffic** | Clash upload/download traffic as a 12-point line chart on a key |
| **AI Usage** | Remaining Claude, Codex, xAI (Grok), Kimi Code, and Moonshot usage, plus Aliyun savings plan balances |
| **Agent Status** | Coding-agent session counts by state, read from `agent-berth` |
| **Sound Controls** | Playback/recording device switching, mic mute, and SoundSwitch profiles (Windows only) |

Configuration, credential resolution, and the bridge's local HTTP API are
documented in [`me.iany.js.ulanziPlugin/README.md`](me.iany.js.ulanziPlugin/README.md).

## Requirements

- Ulanzi Studio 2.1.0 or newer
- Node.js 18 or newer, with npm
- [mise](https://mise.jdx.dev/) to run the tasks below
- Windows 10 or newer for the installer and the Sound Controls; the manifest also
  declares macOS support

## Install

```powershell
mise run install      # every plugin
mise run install:js   # only me.iany.js.ulanziPlugin
```

The installer copies the plugin into `%APPDATA%\Ulanzi\UlanziDeck\Plugins` and
prepares its pinned `ws` and `@napi-rs/canvas` dependencies. Canvas ships native
binaries, so they must match the destination OS and architecture. Restart Ulanzi
Studio afterwards.

## Development

```powershell
mise run bridge                          # shared widget server for the HTML preview
node --test tests/                       # widget, helper, and provider fixture tests
node scripts/check-proxy.cjs [proxyUrl]  # live check of the shared proxy path
```

`mise run bridge` serves only the standalone HTML preview, on port 18765 by
default; inside Ulanzi Studio the plugin starts its own server on an
OS-assigned port. Tests use synthetic credentials and mocked provider responses,
so live readings still require real CLI logins.

## Releases

Pushing a version tag publishes a GitHub Release with the packaged
`me.iany.js.ulanziPlugin.zip`:

```shell
git tag v1.0.1 && git push origin v1.0.1
```

The tag must match the `Version` in `me.iany.js.ulanziPlugin/manifest.json`, so
bump the manifest first and tag that same commit; the workflow fails if they
disagree.

## Layout

| Path | Contents |
| --- | --- |
| `me.iany.js.ulanziPlugin/` | Plugin package: manifest, widget modules, bridge server, property inspectors, and the vendored Ulanzi Node SDK |
| `scripts/` | Install helper and proxy check |
| `tests/` | Node test-runner suites |
| `.github/workflows/` | `test.yml` (tests on `main` and pull requests), `release.yml` (release on version tags) |
