// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { resetCopyButtonFeedback, showCopyButtonFeedback } from "./copy-button-feedback";

describe("showCopyButtonFeedback", () => {
  afterEach(() => vi.useRealTimers());

  it("shows success on the button and restores its compact label", () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    button.textContent = "复制指令";

    showCopyButtonFeedback(button, "success");
    expect(button.textContent).toBe("已复制");
    expect(button.dataset.copyState).toBe("success");

    vi.advanceTimersByTime(1_600);
    expect(button.textContent).toBe("复制指令");
    expect(button.dataset.copyState).toBeUndefined();
  });

  it("cancels stale feedback when the interface language changes", () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    button.textContent = "复制";

    showCopyButtonFeedback(button, "success");
    resetCopyButtonFeedback(button, "Copy");
    vi.advanceTimersByTime(1_600);

    expect(button.textContent).toBe("Copy");
    expect(button.dataset.copyState).toBeUndefined();
  });
});
