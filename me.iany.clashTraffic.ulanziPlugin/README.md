# Clash Traffic — Ulanzi Deck Plugin

Show real-time Clash up/down traffic as a line chart on a Ulanzi Deck key.

## Features

- Connects to the Clash external controller WebSocket at `ws://127.0.0.1:9090/traffic`.
- Renders a 12-point line chart of recent up/down speeds directly on the key icon.
- Shows the current up/down speed in human-readable units (`B`, `K`, `M`, `G`, `T`).
- Auto-reconnects with exponential backoff (1s → 30s) when the Clash service is unavailable.
- Falls back to a bundled offline icon when the WebSocket is not reachable (override per-state via Ulanzi's icon picker).
- Press the key to open a configurable URL (or local path) — different actions for online vs. offline state.

## Settings

Open the property inspector for a Traffic action to configure:

| Field | Description | Default |
|------|-------------|---------|
| **WebSocket URL** | Clash traffic endpoint | `ws://127.0.0.1:9090/traffic` |
| **API Token** | Clash external controller token (optional) | _empty_ |
| **Online Press Action** | URL or local path opened on key press while connected | _empty_ |
| **Offline Press Action** | URL or local path opened on key press while offline | _empty_ |

## Installation

Copy the entire `me.iany.clashTraffic.ulanziPlugin` folder into your Ulanzi Studio plugins directory and restart Ulanzi Studio (or refresh the plugin list in the simulator).

## Identifiers

- Plugin package: `me.iany.clashTraffic.ulanziPlugin`
- Plugin UUID: `me.iany.ulanzistudio.clashTraffic`
- Action UUID: `me.iany.ulanzistudio.clashTraffic.traffic`
