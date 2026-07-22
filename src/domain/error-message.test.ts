import { describe, expect, it } from "vitest";

import { describeError } from "./error-message";

describe("describeError", () => {
  it("preserves Tauri string rejections instead of replacing them", () => {
    expect(describeError("A declared GIF has invalid data")).toBe(
      "A declared GIF has invalid data",
    );
  });

  it("accepts JavaScript errors and safe message objects", () => {
    expect(describeError(new Error("window resize failed"))).toBe("window resize failed");
    expect(describeError({ message: "package exceeds the size limit" })).toBe(
      "package exceeds the size limit",
    );
  });

  it("normalizes whitespace, bounds output, and falls back safely", () => {
    expect(describeError("  first\n\tsecond  ")).toBe("first second");
    expect(Array.from(describeError("界".repeat(800))).length).toBe(512);
    expect(describeError({ reason: "not exposed" }, "操作失败")).toBe("操作失败");

    const hostile = Object.create(null, {
      message: {
        get() {
          throw new Error("getter must not escape");
        },
      },
    });
    expect(describeError(hostile, "操作失败")).toBe("操作失败");
  });
});
