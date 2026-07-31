// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS } from "../domain/settings";
import { BubbleController, SUCCESS_MESSAGE_DURATION_MS } from "./bubble-controller";

describe("BubbleController", () => {
  let bubble: HTMLElement;
  let sessionTitle: HTMLElement;
  let message: HTMLElement;
  let file: HTMLElement;
  let closeButton: HTMLButtonElement;
  let controller: BubbleController;
  let onErrorAcknowledged: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <section id="bubble" hidden>
        <strong id="session-title" hidden></strong>
        <span id="eyebrow"></span>
        <p id="message"></p>
        <p id="file"></p>
        <button id="close"></button>
      </section>`;
    bubble = required("#bubble");
    sessionTitle = required("#session-title");
    message = required("#message");
    file = required("#file");
    closeButton = required("#close");
    onErrorAcknowledged = vi.fn();
    controller = new BubbleController(
      bubble,
      sessionTitle,
      required("#eyebrow"),
      message,
      file,
      closeButton,
      onErrorAcknowledged,
    );
  });

  afterEach(() => {
    controller.dispose();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("shows a fallback for a success event without a message", () => {
    controller.show({ type: "state", state: "success" }, DEFAULT_SETTINGS);
    expect(message.textContent).toBe("任务已完成");
    expect(bubble.dataset.missingCompletionMessage).toBe("true");
    expect(bubble.hidden).toBe(false);
  });

  it("updates application-owned bubble copy when the language changes", () => {
    controller.show({ type: "state", state: "error" }, DEFAULT_SETTINGS);
    controller.setLanguage("en");

    expect(message.textContent).toContain("Agent encountered a problem");
    expect(closeButton.getAttribute("aria-label")).toContain("Acknowledge error");
  });

  it("renders hostile markup as plain text", () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true">';
    controller.show(
      { type: "state", state: "success", message: hostile },
      DEFAULT_SETTINGS,
    );
    expect(message.textContent).toBe(hostile);
    expect(message.querySelector("img")).toBeNull();
  });

  it("shows a session title as plain text and hides it when absent", () => {
    const hostileTitle = '<img src=x onerror="globalThis.pwned=true">';
    controller.show(
      {
        type: "state",
        state: "coding",
        sessionTitle: hostileTitle,
        message: "working",
      },
      DEFAULT_SETTINGS,
    );
    expect(sessionTitle.hidden).toBe(false);
    expect(sessionTitle.textContent).toBe(hostileTitle);
    expect(sessionTitle.querySelector("img")).toBeNull();

    controller.show(
      { type: "state", state: "testing", message: "running" },
      DEFAULT_SETTINGS,
    );
    expect(sessionTitle.hidden).toBe(true);
    expect(sessionTitle.textContent).toBe("");
  });

  it("auto closes, while hover pauses and resumes the remaining time", () => {
    controller.show(
      { type: "state", state: "success", message: "finished" },
      DEFAULT_SETTINGS,
    );
    vi.advanceTimersByTime(5_000);
    bubble.dispatchEvent(new Event("pointerenter"));
    vi.advanceTimersByTime(30_000);
    expect(bubble.hidden).toBe(false);
    bubble.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(9_999);
    expect(bubble.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(bubble.hidden).toBe(true);
  });

  it("resumes an engaged bubble when native hit testing reports pointer leave", () => {
    controller.show(
      { type: "state", state: "success", message: "finished" },
      DEFAULT_SETTINGS,
    );
    vi.advanceTimersByTime(5_000);
    bubble.dispatchEvent(new Event("pointerenter"));
    controller.handleNativePointerLeave();

    vi.advanceTimersByTime(9_999);
    expect(bubble.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(bubble.hidden).toBe(true);
  });

  it("supports manual close", () => {
    controller.show(
      { type: "state", state: "success", message: "finished" },
      DEFAULT_SETTINGS,
    );
    closeButton.click();
    expect(bubble.hidden).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(bubble.hidden).toBe(true);
  });

  it("keeps errors visible until the user acknowledges them", () => {
    controller.show({ type: "state", state: "error" }, DEFAULT_SETTINGS);

    expect(message.textContent).toContain("Agent 遇到问题");
    expect(bubble.dataset.kind).toBe("error");
    expect(bubble.getAttribute("role")).toBe("alert");
    expect(bubble.getAttribute("aria-live")).toBe("assertive");
    expect(closeButton.getAttribute("aria-label")).toContain("确认错误");
    vi.advanceTimersByTime(60_000);
    expect(bubble.hidden).toBe(false);

    closeButton.click();
    expect(bubble.hidden).toBe(true);
    expect(onErrorAcknowledged).toHaveBeenCalledOnce();
  });

  it("shows a file-only detail when file paths are enabled", () => {
    controller.show(
      { type: "state", state: "coding", file: "src/private.ts" },
      { ...DEFAULT_SETTINGS, showFilePath: true },
    );

    expect(bubble.hidden).toBe(false);
    expect(message.hidden).toBe(true);
    expect(file.hidden).toBe(false);
    expect(file.textContent).toBe("src/private.ts");
  });

  it("stays paused until both pointer and focus leave", () => {
    controller.show(
      { type: "state", state: "success", message: "finished" },
      DEFAULT_SETTINGS,
    );
    vi.advanceTimersByTime(5_000);
    bubble.dispatchEvent(new Event("pointerenter"));
    bubble.dispatchEvent(new FocusEvent("focusin"));
    bubble.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(30_000);
    expect(bubble.hidden).toBe(false);

    bubble.dispatchEvent(new FocusEvent("focusout"));
    vi.advanceTimersByTime(10_000);
    expect(bubble.hidden).toBe(true);
  });

  it("pauses while bubble text is selected even after the pointer leaves", () => {
    controller.show(
      { type: "state", state: "success", message: "selectable completion" },
      DEFAULT_SETTINGS,
    );
    const textNode = message.firstChild;
    expect(textNode).not.toBeNull();
    let collapsed = false;
    vi.spyOn(document, "getSelection").mockImplementation(
      () =>
        ({
          anchorNode: textNode,
          focusNode: textNode,
          get isCollapsed() {
            return collapsed;
          },
        }) as unknown as Selection,
    );

    vi.advanceTimersByTime(5_000);
    document.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(30_000);
    expect(bubble.hidden).toBe(false);

    collapsed = true;
    document.dispatchEvent(new Event("selectionchange"));
    vi.advanceTimersByTime(9_999);
    expect(bubble.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(bubble.hidden).toBe(true);
  });

  it("keeps a replacement message paused when the bubble is already engaged", () => {
    controller.show(
      { type: "state", state: "success", message: "first" },
      DEFAULT_SETTINGS,
    );
    bubble.dispatchEvent(new Event("pointerenter"));
    controller.show(
      { type: "state", state: "success", message: "replacement" },
      DEFAULT_SETTINGS,
    );

    vi.advanceTimersByTime(60_000);
    expect(bubble.hidden).toBe(false);
    expect(message.textContent).toBe("replacement");
    bubble.dispatchEvent(new Event("pointerleave"));
    vi.advanceTimersByTime(SUCCESS_MESSAGE_DURATION_MS);
    expect(bubble.hidden).toBe(true);
  });

  it("does not reopen a manually dismissed success from hover details", () => {
    const success = { type: "state", state: "success", message: "finished" } as const;
    controller.show(success, DEFAULT_SETTINGS);
    closeButton.click();

    controller.showDetails(success, DEFAULT_SETTINGS);
    expect(bubble.hidden).toBe(true);

    controller.show({ ...success, message: "new completion" }, DEFAULT_SETTINGS);
    expect(bubble.hidden).toBe(false);
    expect(message.textContent).toBe("new completion");
  });

  it("clears engagement when hidden so the next message can expire", () => {
    controller.show(
      { type: "state", state: "success", message: "first" },
      DEFAULT_SETTINGS,
    );
    bubble.dispatchEvent(new Event("pointerenter"));
    closeButton.click();

    controller.show(
      { type: "state", state: "coding", message: "next" },
      DEFAULT_SETTINGS,
    );
    vi.advanceTimersByTime(4_999);
    expect(bubble.hidden).toBe(false);
    vi.advanceTimersByTime(1);
    expect(bubble.hidden).toBe(true);
  });

  it("clears a visible file path immediately when the privacy switch is disabled", () => {
    controller.show(
      { type: "state", state: "coding", message: "working", file: "src/private.ts" },
      { ...DEFAULT_SETTINGS, showFilePath: true },
    );
    expect(file.textContent).toBe("src/private.ts");

    controller.setFileVisibility(false, "src/private.ts");
    expect(file.textContent).toBe("");
    expect(file.hidden).toBe(true);
    expect(bubble.hidden).toBe(false);
  });

  it("closes a file-only bubble when file paths are disabled", () => {
    controller.show(
      { type: "state", state: "coding", file: "src/private.ts" },
      { ...DEFAULT_SETTINGS, showFilePath: true },
    );

    controller.setFileVisibility(false, "src/private.ts");
    expect(file.hidden).toBe(true);
    expect(bubble.hidden).toBe(true);
  });
});

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}
