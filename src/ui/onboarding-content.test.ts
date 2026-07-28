import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("onboarding content", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const css = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

  it("shows both setup methods and the project introduction entry", () => {
    expect(html).toContain("方法 1：发送指令给代理");
    expect(html).toContain("方法 2：手动配置 MCP");
    expect(html).toContain('id="project-intro-button"');
  });

  it.each([
    "codex-mcp-command",
    "agent-mcp-config",
    "node-npm-check-command",
    "mcp-run-command",
    "npm-cache-command",
    "manual-mcp-config",
  ])("provides a copy button for %s", (targetId) => {
    expect(html).toContain(`id="${targetId}"`);
    expect(html).toContain(`data-copy-target="${targetId}"`);
  });

  it("provides a separate full-agent-prompt copy button", () => {
    expect(html).toContain('id="copy-agent-prompt"');
    expect(html).toContain("复制指令");
    expect(css).toMatch(
      /\.copy-prompt-button\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?top:\s*8px;[\s\S]*?right:\s*8px;/,
    );
  });

  it("does not expose the retired file display checkbox", () => {
    expect(html).not.toContain('id="file-input"');
    expect(html).not.toContain("显示文件");
  });
});
