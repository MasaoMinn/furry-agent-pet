# AGENTS.md

## Project purpose

furry-agent-pet is a lightweight Windows, macOS, and Linux desktop companion. It consumes local state events emitted by `furry-companion-mcp` and turns Agent phases into pet animation, status text, and completion speech bubbles.

The product requirements in `docs/PRD.md` are the source of truth. Keep implementation decisions aligned with that document, and update the PRD when an approved requirement changes.

## Technical baseline

- Tauri 2 application shell.
- Rust owns IPC, protocol validation, window/tray control, diagnostics, and the Tauri Store backend used for settings persistence. The frontend may validate and submit settings, but it must not invent a second persistence format.
- Vanilla TypeScript, HTML, and CSS own presentation. Do not add a frontend framework unless the product has outgrown this structure and the tradeoff is documented.
- Windows uses `\\.\pipe\furry-companion-mcp`; macOS/Linux use `furry-companion-mcp.sock` inside the operating system's temporary directory by default. Do not hardcode `/tmp` because macOS may resolve its temporary directory elsewhere.
- IPC messages are newline-delimited JSON and must remain compatible with `furry-companion-mcp` 0.2.x.
- The supported states are `idle`, `thinking`, `planning`, `coding`, `testing`, `success`, and `error`.

## Agent progress contract

When the `furry_companion` MCP tool is available, publish real progress instead of simulated transitions:

1. Use `thinking` while investigating or reasoning about the task.
2. Use `planning` when a meaningful implementation plan is being formed.
3. Use `coding` immediately before editing project files.
4. Use `testing` while compiling, testing, linting, diagnosing failures, or validating runtime behavior.
5. Use `success` only after the requested work and relevant verification are complete.
6. Use `error` only for an unrecoverable failure, with a concise reason.

The final successful call must include a user-facing completion message:

```json
{
  "state": "success",
  "message": "桌宠的连接逻辑与状态渲染已经完成，并通过了本地构建验证。"
}
```

Completion messages are rendered verbatim in the pet's speech bubble. Write one natural paragraph, preferably 20–200 characters, in the user's language. State the concrete outcome; do not expose secrets, private absolute paths, chain-of-thought, or raw logs. Avoid generic-only text such as “done”. The normal assistant response still needs to summarize the result independently.

## Repository layout

- `src/`: TypeScript UI, state presentation, bubbles, and asset loading.
- `src-tauri/src/`: Rust runtime, IPC client, protocol, window, tray, settings, diagnostics, local pet-package import, and off-screen window recovery.
- `src-tauri/capabilities/`: minimum Tauri permissions required by each window.
- `docs/PRD.md`: product scope, priorities, protocol, acceptance criteria, and open decisions.
- `public/pets/`: bundled pet packages, their manifests, and explicit licensing metadata.

Prefer small focused modules. Do not put IPC parsing, state transition policy, tray behavior, and settings into one large file.

## Development commands

Run from the repository root:

```bash
npm install
npm run dev
npm run check:frontend
npm test
npm run test:rust
npm run check:rust
npm run check
npm run mock:ipc
npm run mock:ipc:protocol
npm run tauri:dev
npm run tauri:build
npm run smoke:windows:native
npm run smoke:windows:installer
```

Run the two Windows smoke commands serially. They share the smoke identity and the same atomic desktop-interaction lock, so overlapping runs fail closed instead of competing for the tray, pointer, or installed application state.

On Windows, use the MSVC Rust toolchain. This workspace has a rustup directory override; if Rust is not found, restart the terminal so `%USERPROFILE%\.cargo\bin` is loaded from the user `PATH`. If the linker cannot find `kernel32.lib`, import `.vsconfig` through Visual Studio Installer to add the Windows SDK.

## Implementation rules

- Keep the application local-first and offline by default. Do not add telemetry or remote services without explicit approval.
- Treat `message` and `file` as untrusted input. Validate length in Rust and render with `textContent`, never `innerHTML`.
- The desktop app is an IPC consumer, not an MCP transport. Do not embed a second MCP stdio server in the UI process.
- Preserve forward compatibility by ignoring unknown JSON fields. Reject unknown states without crashing.
- Parse JSON Lines incrementally; handle partial chunks, multiple lines per chunk, blank lines, disconnects, and malformed payloads.
- IPC disconnect is a connection condition, not the Agent `error` state.
- Use exponential reconnect backoff without busy polling.
- Keep the Tauri capability allowlist minimal. Do not add shell or broad filesystem access for convenience.
- Do not persist completion messages or file paths by default. Logs should redact them unless the user explicitly opts into diagnostic detail.
- Keep transparent-window styling genuinely transparent at `html`, `body`, and application root levels.
- Respect `prefers-reduced-motion` and never encode state by color alone.
- Avoid permanent timers and high-frame-rate animation while idle. Prefer CSS transforms/opacity or bounded sprite animation.
- Do not add heavy dependencies when the platform or standard library can provide the behavior clearly.

## Cross-platform expectations

- Do not claim cross-platform completion from a Windows-only build.
- Keep OS-specific code behind narrow modules and `cfg` gates.
- Window position restoration must account for disconnected monitors and DPI changes.
- Linux behavior must be tested on at least one X11 and one Wayland environment before calling the related acceptance criteria complete.
- Platform-specific limitations must be documented rather than hidden behind inconsistent behavior.

## Pet assets

- Never assume repository code licensing also covers artwork.
- Every bundled pet package must declare author, license, version, canvas dimensions, and per-state assets.
- Keep animation definitions separate from state mappings. Multiple Agent states may reuse one animation, and delayed variants such as sleeping-after-idle must not require duplicating files.
- Treat the real `public/pets/index.json` as the catalog test input. Frontend tests must load every entry through the production loader and recursively require the package media set to equal the manifest reference set; Rust tests must pass every catalog entry through `validate_package_source()`.
- Preserve the initial four GIF hashes, seven-state mapping, and `idle -> sleeping` at exactly 60,000 ms as a compatibility subset, not as a cap on adding animations.
- Keep delayed variants behind the injectable scheduler. Cover exact delay boundaries, cancellation, overrides, stale state revisions, and stale schedule generations; changing an override for a non-current state must not render or reschedule the current state.
- Render only the active animation. Do not preload or decode every GIF frame because the initial four animations expand to roughly 115 MiB when fully decoded.
- Reject package paths that escape the package directory.
- Bound image dimensions, file size, frame count, and frame rate before loading untrusted custom assets.
- Keep local import Rust-owned: the UI selects `pet.json`, Rust validates and snapshots only referenced files, and settings persist only the generated `local-<hash>` catalog ID. Do not render or persist the user's original path.
- Keep the asset protocol restricted to `$APPDATA/pet-packages/**/*`. Do not add broad filesystem, dialog, shell, `$HOME`, or source-directory capabilities to the frontend; the native dialog remains behind the dedicated import command.
- For imported packages, Rust must return one absolute installed `assetPaths` entry for every unique manifest source. The frontend must require an exact key match and call `convertFileSrc` for each file independently. Never resolve a relative media source against an encoded Windows manifest asset URL; encoded backslashes already caused a real runtime failure.
- Preserve the current local-import boundary unless the PRD is deliberately changed: 64 KiB manifest, 64 animations, 10 MiB per asset, 64 MiB total for manifest plus unique referenced media, 2048 px canvas and media dimensions, 300 GIF frames, a 120,000,000 decoded-pixel budget shared across the whole package, 60-second GIF loops, 2-centisecond minimum dynamic-frame delay, and 32 installed local snapshots. APNG and animated WebP are not accepted. PNG/WebP require a bounded full decode; WebP RIFF length, chunk uniqueness, and container/bitstream/decoder dimensions must agree.
- Serialize list/import/remove access to the local package store. Install through a unique staging directory and atomic rename; listing must not delete staging directories at all, and only a new import may clean staging trees at least 24 hours old. Validate generated IDs and canonical containment again before recursive deletion, then require every descendant to be a normal directory or regular file with no link/reparse point; a corrupt imported package must be skipped without breaking the bundled default.
- Use placeholders for engineering work until final art has explicit redistribution permission.

## Validation before handoff

Choose checks proportional to the change, with these minimums:

- TypeScript/UI change: `npm run check:frontend` and `npm run build`.
- Rust/config/plugin change: `npm run check:rust` and `npm run format:rust -- --check`.
- Window or IPC behavior: run `npm run tauri:dev` and exercise the changed behavior locally.
- Local pet-package behavior: run frontend and Rust tests, then use `npm run tauri:dev` to import, restart with the source removed, render through the scoped asset protocol, reject an invalid package, and delete the installed snapshot.
- Window restoration: test a disconnected monitor, a negative-coordinate layout, and mixed-DPI displays; unit-tested geometry alone is not a runtime acceptance result.
- The latest current-source Windows isolated Debug baseline is `.cache/native-windows-smoke/1784697111517-1268` from 2026-07-22: a complete source rebuild produced a 20,264,448-byte EXE with SHA-256 `BE0C7AD5499978751AC0BEA81CDA641DEA3F01C88FFCC731EF4E2B78F8AB5382`; `success=true` and `cleanupSafe=true`. It records both system and manual reduced-motion behavior (`idle.gif`/`hovering-bob -> fallback-idle.svg`/`none -> idle.gif`/`hovering-bob`), persists manual `reduceMotion=true` through the Rust Store and an application restart, nested hover/drag actions, a bounded `clicked` action that restores after its default 650 ms, no synthesized click during the real requested/observed `(96,64)` drag, 140-sample latency (p50 1.35 ms, p95 5.70 ms, max 6.68 ms), the 1001-event-to-2-mutation burst check, `sleeping.gif` after 60,020.66 ms, all six real tray actions, and cleanup. `npm run check` passed 14/14 Vitest files, 74/74 frontend tests, and 57/57 Rust tests. Optional package `interactions.*.durationMs` is bounded to 100-60,000 ms in TypeScript and Rust, drives timed actions, serializes as camelCase, and survives managed snapshot reload after the source is removed. Package-provided interaction animations and the built-in CSS fallback are mutually exclusive; the bundled four-GIF package has empty `interactions`, so the native run exercises its fallback effects while custom mapping/duration boundaries are automated. Package-provided `reducedMotionAnimations` has frontend, Rust validation, and managed-snapshot coverage; the bundled package has no licensed static targets, so the native run exercises its generic static fallback. The installed Release baseline below predates these layers and has not been rerun for the changes.
- The previous 2026-07-16 current-source Windows isolated Debug baseline is the 188.820-second evidence lifecycle at `.cache/native-windows-smoke/1784201511453-9204` (generated `2026-07-16T11:32:14.653Z`, completed `2026-07-16T11:35:23.473Z`): 20,196,864 bytes, SHA-256 `33D052E6D24DB481F364AAC23BF6582784F3911377F5676ED725A42BC17836F4`. Native protocol/UI, all seven states, error acknowledgement, success bubble, hover replay, onboarding/settings Store v1, Rust-owned settings restart restoration, bounded reconnect, single-instance, 140-sample latency (p50 1.53 ms, p95 6.08 ms, max 8.25 ms), and the 1001-event-to-2-mutation burst check pass. The same run observes the real `idle -> sleeping` change after 60,018.8381 ms with a complete 576 x 530 image and no image errors, transparent compositor pixels against two backdrops, actual topmost Z-order, equal client/window bounds, and a real `(96,64)` mouse drag. Its `tray-integration.json` records real interaction with all six tray actions: connected/disconnected menu status, left-click hide/show, menu hide/show, centered position restore, opening and focusing settings while hidden, native/UI/menu topmost synchronization, reconnect, and hidden-window tray exit with code 0. Only connected/disconnected were observed through the live menu; connecting/disabled are unit-tested mappings. The status tooltip assertion is the bound tray icon's UIA accessible name containing the status, not a pixel-exact visual tooltip check, and ordinary taskbar-icon absence was not explicitly verified. Earlier Debug interaction evidence also covers native-dialog import, hash-identical manifest/four-GIF snapshotting, restart and animated playback after the source was renamed, UI deletion with fallback to `furry-ai-state`, and recovery from `(1000000, 1000000)` into a `2560x1600` screen. The Debug link step emits a non-blocking MSVC `LNK4099` warning for missing runtime PDB files.
- The 2026-07-16 installer baseline has an unsigned formal NSIS (5,664,565 bytes, SHA-256 `EA181EFE9A93B153570AA92D893F351049492E821BED7C5064559163E79DF5DF`) and unsigned isolated NSIS (5,665,555 bytes, SHA-256 `E629E932BEB152191A46C98EC73A8F102D49FD5FD98488C1F8B343119F39E7AF`); both are `NotSigned`. The authoritative report is `.cache/windows-installer-smoke/1784201848768-33384/installer-smoke-report.json`. The installed isolated Release at `.cache/native-windows-smoke/1784202165728-19428` passed its then-current full suite, but predates interaction actions and reduced-motion fallback. Physical multi-monitor/mixed-DPI/negative-coordinate layouts, Windows 10/ARM64, macOS, and Linux X11/Wayland still require native testing; signing, final artwork licensing, real external Agent-client UI integration, actual licensed static poster assets, and the PRD resource targets also remain open. See `docs/SMOKE_TEST_REPORT.md`.
- Protocol parsing: cover valid events, partial lines, multiple lines, invalid JSON, unknown states, and oversized fields.
- Completion bubble: cover a normal success message, missing message fallback, long message expansion, timer pause, and manual close.
- Release claim: run a Tauri build on every claimed target OS and record the artifact and smoke-test result.

Do not report success only because files were generated. Report the exact checks run and any platform behavior that remains unverified.
