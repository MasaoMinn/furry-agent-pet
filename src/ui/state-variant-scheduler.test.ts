// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StateVariantScheduler } from "./state-variant-scheduler";

function createScheduler(): StateVariantScheduler {
  return new StateVariantScheduler({
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
  });
}

describe("state variant scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("activates sleeping only after idle has lasted sixty seconds", () => {
    const activate = vi.fn();
    createScheduler().schedule({
      variants: [{ animation: "sleeping", activateAfterMs: 60_000 }],
      disabled: false,
      isCurrent: () => true,
      activate,
    });

    vi.advanceTimersByTime(59_999);
    expect(activate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(activate).toHaveBeenCalledOnce();
    expect(activate).toHaveBeenCalledWith("sleeping");
  });

  it("cancels the previous state's variants when a new state is scheduled", () => {
    const activate = vi.fn();
    const scheduler = createScheduler();
    scheduler.schedule({
      variants: [{ animation: "sleeping", activateAfterMs: 60_000 }],
      disabled: false,
      isCurrent: () => true,
      activate,
    });
    scheduler.schedule({ variants: [], disabled: false, isCurrent: () => true, activate });

    vi.advanceTimersByTime(60_000);
    expect(activate).not.toHaveBeenCalled();
  });

  it("does not schedule delayed variants when the user selected an override", () => {
    const activate = vi.fn();
    createScheduler().schedule({
      variants: [{ animation: "sleeping", activateAfterMs: 60_000 }],
      disabled: true,
      isCurrent: () => true,
      activate,
    });

    vi.runAllTimers();
    expect(activate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores a callback when the state revision is no longer current", () => {
    const activate = vi.fn();
    let current = true;
    createScheduler().schedule({
      variants: [{ animation: "sleeping", activateAfterMs: 60_000 }],
      disabled: false,
      isCurrent: () => current,
      activate,
    });

    current = false;
    vi.advanceTimersByTime(60_000);
    expect(activate).not.toHaveBeenCalled();
  });

  it("rejects an already queued callback from an older schedule generation", () => {
    const queued: Array<() => void> = [];
    const activate = vi.fn();
    const scheduler = new StateVariantScheduler({
      setTimeout: (callback) => {
        queued.push(callback);
        return queued.length;
      },
      clearTimeout: () => {
        // A callback that has already entered the event queue cannot always be removed.
      },
    });
    scheduler.schedule({
      variants: [{ animation: "sleeping", activateAfterMs: 60_000 }],
      disabled: false,
      isCurrent: () => true,
      activate,
    });
    scheduler.schedule({ variants: [], disabled: false, isCurrent: () => true, activate });

    queued[0]();
    expect(activate).not.toHaveBeenCalled();
  });
});
