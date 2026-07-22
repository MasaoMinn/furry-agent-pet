import { describe, expect, it } from "vitest";

import { AGENT_CONNECTION_PROMPT } from "./agent-connection-prompt";

describe("AGENT_CONNECTION_PROMPT", () => {
  it("contains setup guidance and the complete runtime state contract", () => {
    expect(AGENT_CONNECTION_PROMPT).toContain("furry-agent-pet");
    expect(AGENT_CONNECTION_PROMPT).toContain("npx -y furry-companion-mcp");
    expect(AGENT_CONNECTION_PROMPT).toContain("furry_companion.set_state");
    for (const state of ["thinking", "planning", "coding", "testing", "success", "error"]) {
      expect(AGENT_CONNECTION_PROMPT).toContain(state);
    }
  });

  it("warns the agent not to expose private details", () => {
    expect(AGENT_CONNECTION_PROMPT).toContain("私密路径、密钥或推理过程");
  });
});
