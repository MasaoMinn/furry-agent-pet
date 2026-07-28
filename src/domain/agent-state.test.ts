import { describe, expect, it } from "vitest";

import { AGENT_STATES, parseAgentStateEvent } from "./agent-state";

describe("parseAgentStateEvent", () => {
  it("accepts every supported state and ignores unknown fields", () => {
    for (const state of AGENT_STATES) {
      expect(
        parseAgentStateEvent({ type: "state", state, message: "ok", future: true }),
      ).toEqual({ type: "state", state, message: "ok" });
    }
  });

  it("rejects malformed protocol fields", () => {
    expect(parseAgentStateEvent({ type: "other", state: "idle" })).toBeNull();
    expect(parseAgentStateEvent({ type: "state", state: "unknown" })).toBeNull();
    expect(parseAgentStateEvent({ type: "state", state: "idle", message: 7 })).toBeNull();
    expect(parseAgentStateEvent({ type: "state", state: "idle", message: null })).toBeNull();
    expect(parseAgentStateEvent({ type: "state", state: "idle", file: "x".repeat(1_001) })).toBeNull();
    expect(
      parseAgentStateEvent({ type: "state", state: "idle", session_title: 7 }),
    ).toBeNull();
  });

  it("preserves untrusted text for safe textContent rendering", () => {
    const message = '<img src=x onerror="globalThis.pwned=true">';
    expect(parseAgentStateEvent({ type: "state", state: "success", message })).toEqual({
      type: "state",
      state: "success",
      message,
    });
  });

  it("maps the optional wire session title without trusting its contents", () => {
    const sessionTitle = '<img src=x onerror="globalThis.pwned=true">';
    expect(
      parseAgentStateEvent({
        type: "state",
        state: "testing",
        session_title: sessionTitle,
        message: "running",
      }),
    ).toEqual({ type: "state", state: "testing", sessionTitle, message: "running" });
  });

  it("accepts the 1000 character field boundary", () => {
    const message = "中".repeat(1_000);
    expect(parseAgentStateEvent({ type: "state", state: "coding", message })?.message).toBe(
      message,
    );
  });

  it("counts emoji as Unicode code points like the Rust validator", () => {
    const message = "🦊".repeat(1_000);
    expect(parseAgentStateEvent({ type: "state", state: "thinking", message })?.message).toBe(
      message,
    );
    expect(
      parseAgentStateEvent({ type: "state", state: "thinking", message: `${message}🦊` }),
    ).toBeNull();
  });
});
