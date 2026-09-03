# iany's JS Widgets — Ulanzi Deck Plugin

A collection of JavaScript widgets that share one Ulanzi Deck plugin service.
Only Clash Traffic is included for now; future widgets can be registered in the
same service and added to the same manifest.

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

## Adding another widget

Add its action to `manifest.json`, load its isolated runtime module from
`plugin/app.html`, and register its action UUID in `plugin/app.js`. The shared
service owns Ulanzi events and routes each key context to its widget instance.

## Identifiers

- Plugin package: `me.iany.js.ulanziPlugin`
- Plugin UUID: `me.iany.ulanzistudio.js`
- Clash Traffic action UUID: `me.iany.ulanzistudio.js.clashTraffic`
