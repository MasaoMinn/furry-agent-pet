import { describe, expect, it } from "vitest";

import { isPetClickGesture } from "./pet-click-gesture";

describe("isPetClickGesture", () => {
  it("accepts mouse clicks through the exact duration boundary", () => {
    expect(isPetClickGesture(1, 1_000, 1_299, 300)).toBe(true);
    expect(isPetClickGesture(1, 1_000, 1_300, 300)).toBe(true);
    expect(isPetClickGesture(1, 1_000, 1_301, 300)).toBe(false);
  });

  it("rejects invalid time order and accepts keyboard or synthetic activation", () => {
    expect(isPetClickGesture(1, 1_001, 1_000, 300)).toBe(false);
    expect(isPetClickGesture(0, 1_000, 9_000, 300)).toBe(true);
    expect(isPetClickGesture(1, null, 9_000, 300)).toBe(true);
  });
});
