import { describe, expect, it } from "vitest";

import { PROJECT_INTRO_URL } from "./project-intro";

describe("PROJECT_INTRO_URL", () => {
  it("uses the approved Feishu project page", () => {
    const url = new URL(PROJECT_INTRO_URL);
    expect(url.protocol).toBe("https:");
    expect(url.hostname).toBe("kcnhl2uub4k0.feishu.cn");
    expect(url.pathname).toBe("/wiki/OuBCwjPX7iBL9PkZOjccKvGQnGf");
  });
});
