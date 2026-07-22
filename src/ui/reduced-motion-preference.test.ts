import { describe, expect, it, vi } from "vitest";

import { ReducedMotionPreference } from "./reduced-motion-preference";

describe("ReducedMotionPreference", () => {
  it("tracks the operating-system preference", () => {
    const onChange = vi.fn();
    const preference = new ReducedMotionPreference(onChange);

    preference.setSystemRequested(true);
    expect(preference.enabled).toBe(true);
    expect(onChange.mock.calls.map(([enabled]) => enabled)).toEqual([true]);

    preference.setSystemRequested(false);
    expect(preference.enabled).toBe(false);
    expect(onChange.mock.calls.map(([enabled]) => enabled)).toEqual([true, false]);
  });

  it("does not publish duplicate effective values", () => {
    const onChange = vi.fn();
    const preference = new ReducedMotionPreference(onChange);

    preference.setSystemRequested(false);
    preference.setSystemRequested(true);
    preference.setSystemRequested(true);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
