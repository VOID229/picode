# picode

`picode` is a desktop-native agent manager for Pi, built with Tauri v2, React, and TypeScript for macOS and Linux. This scaffold ships the shell, workspace/chat navigation, themed UI system, a typed frontend/backend bridge, JSON-backed local state, and a sidecar-oriented Pi runtime path with a bundled mock adapter for bring-up.

## Stack

- Bun for frontend package management and scripts
- Vite + React 19 + TypeScript
- Tauri v2 shell
- Rust backend with JSON persistence and git/process plumbing
- Theme system with dark, light, Catppuccin, Nord, Gruvbox, and Solarized

## Setup

1. Install Bun and Rust.
2. Install Tauri system prerequisites for your OS.
3. Install frontend dependencies:

```bash
bun install
```

## Development

Run the web UI:

```bash
bun run dev
```

Run the desktop app:

```bash
bun run tauri:dev
```

## Build and Package

Build the frontend bundle:

```bash
bun run build
```

Build desktop packages:

```bash
bun run tauri:build
```

Current packaging targets in `tauri.conf.json` are:

- macOS: `dmg`
- Linux: `appimage`, `deb`, `rpm`

## Architecture

The app uses a Tauri shell with a typed Rust command layer. The frontend invokes commands for bootstrap, workspace/session mutations, approvals, settings, and git refresh. Streaming agent activity arrives as typed Tauri events on `pi://event`.

The process model is sidecar-first:

- `src-tauri` owns lifecycle, persistence, and OS integration.
- a Pi adapter sidecar is launched for prompts
- the current scaffold includes `src-tauri/bin/pi-sidecar`, a mock transport-compatible adapter for local bring-up
- production packaging swaps that binary for the real bundled Pi executable without changing the UI contract

## Storage

App-owned state is stored as JSON under the platform app-data directory:

- workspace registry
- pinned/recent workspaces
- sessions and timeline items
- theme/layout/model preferences
- approval mode and policy defaults

Schema versioning is included in the stored payload to keep migrations straightforward.

## Permissions

Approval modes:

- `Ask First`
- `Full Access`

The scaffold already models risky-action approvals, allowed paths, allowed commands, env passthrough, and a network toggle in settings. Approval requests are surfaced inline in the conversation timeline and can be accepted or denied from the keyboard or mouse.

## Notes

- The repository includes a vertical slice, not the full Pi product surface.
- The sidecar contract and event model are shaped for real Pi integration.
- Git data is fetched safely with read-only commands in the current scaffold.
