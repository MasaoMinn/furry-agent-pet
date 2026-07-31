import { describe, expect, it } from "vitest";

import {
  agentConnectionPrompt,
  normalizeLanguage,
  stateLabel,
  translate,
} from "./i18n";

describe("interface localization", () => {
  it("normalizes the supported Chinese and English language values", () => {
    expect(normalizeLanguage("en")).toBe("en");
    expect(normalizeLanguage("zh-CN")).toBe("zh-CN");
    expect(normalizeLanguage("de")).toBe("zh-CN");
  });

  it("translates state and parameterized interface messages", () => {
    expect(stateLabel("zh-CN", "coding")).toBe("编码中");
    expect(stateLabel("en", "coding")).toBe("Coding");
    expect(translate("en", "connectionDetails", { error: "pipe closed" })).toBe(
      "Connection details: pipe closed",
    );
  });

  it("provides localized copyable Agent setup prompts without changing commands", () => {
    const chinese = agentConnectionPrompt("zh-CN");
    const english = agentConnectionPrompt("en");
    expect(chinese).toContain("请为当前环境安装");
    expect(english).toContain("Install Furry Companion MCP");
    expect(chinese).toContain("codex mcp add furry_companion");
    expect(english).toContain("codex mcp add furry_companion");
  });
});
