# Picode

Picode is a minimal desktop GUI for coding agents using Pi.

Built with Tauri v2, React, and TypeScript, it provides a native shell for managing projects, sessions, git context, and Pi-backed agent runs from one interface.

## Features

- Workspace and session management
- Git context and local project state
- Uses a system-installed `pi` CLI over official RPC mode
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
- A system-installed Pi CLI

Install Pi globally and complete its login/config flow:

```bash
npm install -g @mariozechner/pi-coding-agent
pi
/login
```

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
Pi session files are stored under the app-data directory in `pi-sessions/`.
