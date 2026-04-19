# Picode

Picode is a minimal web GUI for coding agents using Pi

Built with Tauri v2, React, and TypeScript, it provides a native shell for managing projects, sessions, approvals, and provider-backed agent runs from one interface.

## Features

- Workspace and session management
- Inline approval flow for risky actions
- Git context and local project state
- Bundled `pi-runtime` sidecar bridge
- macOS and Linux build targets

## Providers

Picode uses Pi as the backend which can connect to:

- Codex
- Claude
- OpenCode
- Ollama

## Local Development

Install the required tooling first:

- Bun
- Rust
- Tauri prerequisites for your OS

Install dependencies:

```bash
bun install
```

Run the desktop app:

```bash
bun run tauri:dev
```

Run only the web UI:

```bash
bun run dev
```

## Build

Create a production desktop build:

```bash
bun run tauri:build
```

Create a macOS DMG:

```bash
bun run dmg
```

Current packaging targets:

- macOS: `dmg`
- Linux: `appimage`, `deb`, `rpm`

## Notes

Picode is still early. Expect rough edges.

App state is stored locally in the platform app-data directory.
