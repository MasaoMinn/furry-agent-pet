import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("status controls", () => {
  it("places the settings toggle immediately beside the visible status text", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const stateChip = html.match(/<p class="state-chip"[^>]*>([\s\S]*?)<\/p>/)?.[1];

    expect(stateChip).toBeDefined();
    expect(stateChip).toContain('id="connection-label"');
    expect(stateChip).toContain('id="settings-toggle"');
    expect(stateChip?.indexOf('id="settings-toggle"')).toBeGreaterThan(
      stateChip?.indexOf('id="connection-label"') ?? -1,
    );
    expect(html).not.toContain('id="last-event-label"');
    expect(html).not.toContain('id="onboarding-last-event-label"');
    expect(html).not.toContain("最近事件：");
    expect(html).toContain("<title>furry-agent-pet</title>");
    expect(html).not.toContain("Agent Desktop Pet");
  });
});
