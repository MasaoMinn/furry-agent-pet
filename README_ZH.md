# furry-agent-pet

[English](README.md) | [简体中文](README_ZH.md)

## 项目简介

`furry-agent-pet` 是一款轻量、离线优先的 Windows 桌宠，用角色动作、状态文字和完成气泡展示 MCP Agent 的实时工作阶段。

应用支持 Windows，能够表现以下 Agent 状态：

- `idle`：空闲
- `thinking`：思考
- `planning`：规划
- `coding`：编码
- `testing`：测试
- `success`：成功
- `error`：错误

桌宠通过本机 IPC 接收状态，不读取 Agent 的内部推理，也不会把状态、消息或文件路径上传到远端。角色动作由可扩展的宠物包定义，并可独立扩展悬停、拖拽和点击等交互动作。

## 技术栈

- Tauri 2
- Rust + Tokio
- Vanilla TypeScript + Vite
- Tauri Store、Window State、Single Instance、Autostart
- Vitest

## Agent 接入说明

桌宠本身不是 MCP Server。Agent 需要加载 `furry-companion-mcp`，通过其 `set_state` 工具上报真实进度；runtime 再经 Windows Named Pipe 把状态转发给桌宠。

```text
MCP Agent
  -> furry-companion-mcp set_state
  -> Windows Named Pipe
  -> furry-agent-pet
```

### 注册 MCP Server

Codex 可通过以下命令注册：

```bash
codex mcp add furry-companion -- npx -y furry-companion-mcp
codex mcp list
```

其他支持 stdio MCP Server 的客户端可使用：

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

### 状态上报约定

Agent 应在真实工作阶段调用 `furry_companion.set_state`：

- 调查和推理时上报 `thinking`
- 形成实施方案时上报 `planning`
- 编辑代码或文件时上报 `coding`
- 构建、测试和验证时上报 `testing`
- 任务确实完成时上报 `success`，并在 `message` 中提供给用户看的完成说明
- 遇到无法恢复的失败时上报 `error`

示例：

```json
{
  "state": "success",
  "message": "桌宠的连接与状态展示已经完成。"
}
```

默认 IPC 地址：

- Windows：`\\.\pipe\furry-companion-mcp`

完整接入说明见 [`docs/AGENT_INTEGRATION.md`](docs/AGENT_INTEGRATION.md)。
