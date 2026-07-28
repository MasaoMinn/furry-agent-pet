export const CODEX_MCP_COMMAND = "codex mcp add furry_companion -- npx -y furry-companion-mcp";

export const MCP_CONFIG_JSON = `{
  "mcpServers": {
    "furry_companion": {
      "command": "npx",
      "args": ["-y", "furry-companion-mcp"]
    }
  }
}`;

export const NODE_NPM_CHECK_COMMAND = "node -v && npm -v";
export const MCP_RUN_COMMAND = "npx -y furry-companion-mcp";
export const NPM_CACHE_VERIFY_COMMAND = "npm cache verify";

export const AGENT_CONNECTION_PROMPT = `请为当前环境安装 Furry Companion MCP：

Codex:
${CODEX_MCP_COMMAND}

Cursor / Claude Desktop:
在 MCP 配置中加入：
${MCP_CONFIG_JSON}

安装后请重启 Agent 会话，并验证 MCP tools 中是否出现 set_state。

如果失败：
1. 先确认 Node.js 和 npm 可用：${NODE_NPM_CHECK_COMMAND}
2. 测试包能运行：${MCP_RUN_COMMAND}
3. 若提示权限或网络错误，清理 npm 缓存后重试：${NPM_CACHE_VERIFY_COMMAND}
4. 若 MCP 已存在，先移除旧配置再重新添加。`;
