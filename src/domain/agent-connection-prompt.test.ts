import { describe, expect, it } from "vitest";

import {
  AGENT_CONNECTION_PROMPT,
  CODEX_MCP_COMMAND,
  MCP_CONFIG_JSON,
  MCP_RUN_COMMAND,
  NODE_NPM_CHECK_COMMAND,
  NPM_CACHE_VERIFY_COMMAND,
} from "./agent-connection-prompt";

describe("AGENT_CONNECTION_PROMPT", () => {
  it("contains the requested agent-managed setup instructions", () => {
    expect(AGENT_CONNECTION_PROMPT).toContain("请为当前环境安装 Furry Companion MCP");
    expect(AGENT_CONNECTION_PROMPT).toContain(CODEX_MCP_COMMAND);
    expect(AGENT_CONNECTION_PROMPT).toContain(MCP_CONFIG_JSON);
    expect(AGENT_CONNECTION_PROMPT).toContain("验证 MCP tools 中是否出现 set_state");
  });

  it("contains every troubleshooting command shown by the guide", () => {
    expect(AGENT_CONNECTION_PROMPT).toContain(NODE_NPM_CHECK_COMMAND);
    expect(AGENT_CONNECTION_PROMPT).toContain(MCP_RUN_COMMAND);
    expect(AGENT_CONNECTION_PROMPT).toContain(NPM_CACHE_VERIFY_COMMAND);
    expect(JSON.parse(MCP_CONFIG_JSON)).toEqual({
      mcpServers: {
        furry_companion: {
          command: "npx",
          args: ["-y", "furry-companion-mcp"],
        },
      },
    });
  });
});
