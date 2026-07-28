# 接入真实 MCP Agent

桌宠不会直接读取 Codex、Claude 或 Cursor 的内部状态。Agent 需要先加载 `furry-companion-mcp`，由它提供 `set_state` MCP 工具并把状态转发到本地 IPC；桌宠只消费这条 IPC 链路。

## 前置条件

- Node.js 20 或更高版本。
- 支持 stdio MCP server 的 Agent 客户端。
- `furry-companion-mcp` 0.2.x；本项目当前按 0.2.0 协议开发和验证。

## 推荐注册方式

Codex CLI 可直接注册该 stdio server：

```bash
codex mcp add furry-companion -- npx -y furry-companion-mcp
codex mcp list
```

Codex 的 CLI、IDE 扩展与桌面应用共享 MCP 配置；如命令或配置格式发生变化，以 [Codex MCP 官方文档](https://developers.openai.com/codex/mcp) 为准。

`furry-companion-mcp` 仓库提供的通用 `mcpServers` JSON 如下：

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

将这一 server 定义转换或放入 Codex、Claude Code / Desktop、Cursor 或其他客户端当前版本要求的 MCP 配置中。各客户端的配置文件位置和顶层格式会变化，本仓库暂不把某一版本的路径写成通用事实；应以所用客户端的当前官方文档为准。

如果不希望使用 `npx`，runtime 仓库也确认支持全局安装：

```bash
npm install -g furry-companion-mcp
furry-companion-mcp
```

全局命令通常仍应由 MCP 客户端按 stdio server 启动，而不是长期单独打开一个无人管理的终端进程。

从 runtime 源码运行时使用：

```bash
npm install
npm run build
npm run start
```

## 让 Agent 正确上报状态

runtime 包含 `skills/codex.md`、`skills/claude.md`、`skills/cursor.md` 和 `skills/INSTALL.md`。安装 npm 包或注册 MCP server 不会自动启用这些行为规则；需要按客户端的指令/skill 机制复制或引用对应文件。

核心约定是让 Agent 在真实阶段调用 `set_state`：

- `thinking`：调查、分析和推理。
- `planning`：形成实施计划。
- `coding`：编辑代码或文件。
- `testing`：构建、测试和验证。
- `success`：任务确实完成；`message` 写给用户看的具体结束语。
- `error`：确实无法恢复的失败。
- `idle`：没有活动任务。

`message` 与 `file` 是可选字符串，分别不超过 1000 个字符。兼容的 runtime 还可在 JSON Lines 事件中提供可选 `session_title`；桌宠会把它显示在气泡顶部，用于区分会话。当前 `furry-companion-mcp` 0.2.0 的 `set_state` 工具尚未暴露该参数，因此 0.2.0 事件继续正常显示但没有会话标题。所有字段都按不可信文本处理，不执行其中的 HTML。

## IPC 地址

- Windows：`\\.\pipe\furry-companion-mcp`

桌宠设置页不提供自定义 IPC 地址，正常使用时无需配置。开发诊断若设置 `FURRY_COMPANION_IPC_PATH`，必须用同一个环境变量启动 runtime 与桌宠，并使用合法的 Windows Named Pipe 地址。

## 验证连接

1. 可以先启动桌宠；runtime 不存在时，桌宠应保持 `idle` 并显示“未连接”。
2. 启动已注册 MCP server 的 Agent 客户端。
3. 打开桌宠设置，确认状态变为“已连接”，并核对当前地址。
4. 让 Agent 执行一个小任务；桌宠应按阶段切换表现，并保持连接状态为“已连接”。
5. 若未连接，查看设置页可见的“连接详情”，确认两端地址一致后单击“重新连接”。

## 发布包兼容烟测

仓库提供 `scripts/smoke-published-mcp.mjs`。它用独立临时 IPC 地址启动指定的发布版 runtime，完成 MCP `initialize`、`tools/list` 和 `set_state` 调用，再确认本地 IPC 收到 `idle`、`coding` 和带结束语的 `success`。它不会修改 Codex、Cursor 或 Claude 的配置。

把 npm 包安装或解压到工作区内的测试目录后运行：

```bash
npm run smoke:mcp:published -- --runtime <furry-companion-mcp-dist-index.js>
```

2026-07-15 首次在 Windows 11 x64 对 npm 发布版 `0.2.0` 执行通过，2026-07-16 使用当前桌宠源码再次通过。这个脚本验证 runtime 的 stdio MCP→本地 IPC bridge，不替代安装后桌宠 UI 与真实 Agent 客户端的完整端到端验收。

## 协议与隐私边界

runtime 是 stdio MCP server，本桌宠不实现第二套 MCP transport。状态通过本机 Windows Named Pipe 传递，应用默认不上传遥测，也不持久化 Agent 的 `session_title`、`message` 或 `file` 内容。
