import { describe, expect, it } from "vitest";

import { isPetClickGesture, isPetNativeClickGesture } from "./pet-click-gesture";

describe("isPetClickGesture", () => {
  it("accepts a stationary pointer through the exact duration and movement boundaries", () => {
    expect(isPetClickGesture(1_000, 1_300, 3, 4, 300, 5)).toBe(true);
    expect(isPetClickGesture(1_000, 1_301, 3, 4, 300, 5)).toBe(false);
    expect(isPetClickGesture(1_000, 1_300, 3, 4.01, 300, 5)).toBe(false);
  });

  it("rejects invalid time order and real window movement", () => {
    expect(isPetClickGesture(1_001, 1_000, 0, 0, 300, 5)).toBe(false);
    expect(isPetClickGesture(1_000, 1_100, 96, 64, 300, 5)).toBe(false);
  });

  it("requires native button release and negligible window movement", () => {
    expect(isPetNativeClickGesture(true, 3, 4, 5)).toBe(true);
    expect(isPetNativeClickGesture(false, 0, 0, 5)).toBe(false);
    expect(isPetNativeClickGesture(true, 6, 0, 5)).toBe(false);
  });
});
