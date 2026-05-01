# Picode Agent Rules

Picode is a minimal desktop GUI for coding agents using Pi. It is a Tauri v2 app with a React/TypeScript frontend and a Rust backend.

## Non-Negotiables

- Use Bun for all TypeScript package and script work. Never use npm, yarn, pnpm, or npx.
- Install TypeScript dependencies with Bun commands, for example `bun add ...` or `bun add -d ...`; do not hand-edit `package.json` for package installs.
- Keep changes small, practical, and aligned with the existing codebase. Do not add abstractions, dependencies, or broad refactors unless they are clearly needed.
- Preserve user work. Do not revert unrelated local changes.
- Run the appropriate formatter after edits. If no formatter command exists for the affected language, ask before adding one.
- Ask numbered questions when asking multiple questions.

## Project Facts

- Frontend: React, TypeScript, Vite.
- Desktop shell: Tauri v2.
- Backend: Rust under `src-tauri/`.
- Package manager/runtime for TypeScript: Bun.
- License: AGPL-3.0-only.
- Pi integration uses a system-installed `pi` CLI over official RPC mode.
- App state is local, with Pi session files under the app-data `pi-sessions/` directory.
- macOS DMG packaging is the polished release target; Linux support is experimental and source-build oriented.

## Common Commands

- Install dependencies: `bun install`
- Run desktop app: `bun run tauri:dev`
- Run web UI only: `bun run dev`
- Build frontend: `bun run build`
- Build desktop app: `bun run tauri:build`
- Build macOS DMG: `bun run dmg`

## Implementation Guidance

- Match existing UI patterns and styling before introducing new ones.
- Use `lucide-react` icons for icon buttons when an appropriate icon exists.
- Prefer existing stores, services, and bridge modules over new global state or ad hoc IPC.
- Treat terminal, Git, and Pi session behavior as user-critical. Be conservative and test flows that touch them.
- Keep rendered Markdown sanitized and avoid weakening security boundaries around chat content.
- Do not overstate Linux packaging support; it is experimental.
