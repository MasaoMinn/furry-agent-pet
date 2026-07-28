# furry-agent-pet

[English](README.md) | [简体中文](README_ZH.md)

## Introduction

`furry-agent-pet` is a lightweight, offline-first Windows desktop companion that visualizes an MCP Agent's real-time work through character animations, status text, and completion bubbles.

The app supports Windows and represents these Agent states:

- `idle`
- `thinking`
- `planning`
- `coding`
- `testing`
- `success`
- `error`

The pet receives state updates through local IPC. It does not read an Agent's private reasoning or upload states, messages, or file paths. Its manifest-driven pet packages can define extensible state animations and independent interactions such as hovering, dragging, and clicking.

## Tech Stack

- Tauri 2
- Rust + Tokio
- Vanilla TypeScript + Vite
- Tauri Store, Window State, Single Instance, and Autostart
- Vitest

## Agent Integration

The desktop pet is not an MCP server. The Agent loads `furry-companion-mcp` and reports real progress through its `set_state` tool. The runtime then forwards state events to the pet through a local Windows named pipe.

```text
MCP Agent
  -> furry-companion-mcp set_state
  -> Windows Named Pipe
  -> furry-agent-pet
```

### Register the MCP Server

Register it with Codex:

```bash
codex mcp add furry-companion -- npx -y furry-companion-mcp
codex mcp list
```

Other clients that support stdio MCP servers can use:

```json
{
  "mcpServers": {
    "furry-companion": {
      "command": "npx",
      "args": ["-y", "furry-companion-mcp"]
    }
  }
}
```

### State Reporting Contract

The Agent should call `furry_companion.set_state` at each real work stage:

- Report `thinking` while investigating and reasoning.
- Report `planning` while forming an implementation plan.
- Report `coding` while editing code or files.
- Report `testing` while building, testing, or validating.
- Report `success` only after completion, with a user-facing summary in `message`.
- Report `error` only for an unrecoverable failure.

Example:

```json
{
  "state": "success",
  "message": "The desktop pet connection and state display are ready."
}
```

Default IPC address:

- Windows: `\\.\pipe\furry-companion-mcp`

See [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md) for the complete integration guide.
