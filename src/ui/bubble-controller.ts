import type { AgentStateEvent } from "../domain/agent-state";
import { stateLabel, translate, type AppLanguage } from "../domain/i18n";
import type { AppSettings } from "../domain/settings";

const NORMAL_MESSAGE_DURATION_MS = 5_000;
export const SUCCESS_MESSAGE_DURATION_MS = 15_000;

export class PausableTimer {
  private handle: number | null = null;
  private remainingMs = 0;
  private startedAt = 0;
  private callback: (() => void) | null = null;

  start(durationMs: number, callback: () => void): void {
    this.cancel();
    this.remainingMs = durationMs;
    this.callback = callback;
    this.resume();
  }

  pause(): void {
    if (this.handle === null) {
      return;
    }
    window.clearTimeout(this.handle);
    this.handle = null;
    this.remainingMs = Math.max(0, this.remainingMs - (performance.now() - this.startedAt));
  }

  resume(): void {
    if (this.handle !== null || this.callback === null) {
      return;
    }
    this.startedAt = performance.now();
    this.handle = window.setTimeout(() => {
      const callback = this.callback;
      this.handle = null;
      this.callback = null;
      this.remainingMs = 0;
      callback?.();
    }, this.remainingMs);
  }

  cancel(): void {
    if (this.handle !== null) {
      window.clearTimeout(this.handle);
    }
    this.handle = null;
    this.remainingMs = 0;
    this.callback = null;
  }
}

export class BubbleController {
  private readonly timer = new PausableTimer();
  private hovered = false;
  private focused = false;
  private selecting = false;
  private displayedEvent: AgentStateEvent | null = null;
  private dismissedSuccessEvent: AgentStateEvent | null = null;
  private language: AppLanguage = "zh-CN";

  constructor(
    private readonly bubble: HTMLElement,
    private readonly sessionTitle: HTMLElement,
    private readonly eyebrow: HTMLElement,
    private readonly message: HTMLElement,
    private readonly file: HTMLElement,
    private readonly closeButton: HTMLButtonElement,
    private readonly onErrorAcknowledged: () => void = () => undefined,
  ) {
    closeButton.addEventListener("click", this.handleManualClose);
    bubble.addEventListener("pointerenter", () => {
      this.hovered = true;
      this.timer.pause();
    });
    bubble.addEventListener("pointerleave", () => {
      this.hovered = false;
      this.resumeIfUnengaged();
    });
    bubble.addEventListener("focusin", () => {
      this.focused = true;
      this.timer.pause();
    });
    bubble.addEventListener("focusout", (event) => {
      this.focused = event.relatedTarget instanceof Node && bubble.contains(event.relatedTarget);
      this.resumeIfUnengaged();
    });
    document.addEventListener("selectionchange", this.handleSelectionChange);
  }

  show(event: AgentStateEvent, settings: AppSettings): void {
    this.showEvent(event, settings, false);
  }

  showDetails(event: AgentStateEvent, settings: AppSettings): void {
    this.showEvent(event, settings, true);
  }

  dispose(): void {
    this.timer.cancel();
    document.removeEventListener("selectionchange", this.handleSelectionChange);
    this.closeButton.removeEventListener("click", this.handleManualClose);
  }

  setLanguage(language: AppLanguage): void {
    this.language = language;
    const event = this.displayedEvent;
    if (!event) {
      return;
    }
    this.eyebrow.textContent = stateLabel(language, event.state);
    if (!event.message) {
      this.message.textContent = event.state === "success"
        ? translate(language, "taskComplete")
        : event.state === "error"
          ? translate(language, "agentError")
          : "";
    }
    this.updateCloseLabel(event.state === "error");
  }

  handleNativePointerLeave(): void {
    this.hovered = false;
    this.resumeIfUnengaged();
  }

  private showEvent(event: AgentStateEvent, settings: AppSettings, detailsOnly: boolean): void {
    if (detailsOnly && event.state === "success" && this.dismissedSuccessEvent === event) {
      return;
    }
    if (!detailsOnly && event.state === "success") {
      this.dismissedSuccessEvent = null;
    }

    if (!settings.showStateBubble) {
      this.hide();
      return;
    }

    const isSuccess = event.state === "success";
    const isError = event.state === "error";
    const text = event.message || (isSuccess
      ? translate(this.language, "taskComplete")
      : isError
        ? translate(this.language, "agentError")
        : "");
    const visibleFile = settings.showFilePath && event.file ? event.file : "";
    if (text === "" && visibleFile === "") {
      this.hide();
      return;
    }

    this.displayedEvent = event;
    this.sessionTitle.textContent = event.sessionTitle ?? "";
    this.sessionTitle.hidden = !event.sessionTitle;
    this.sessionTitle.title = event.sessionTitle ?? "";
    this.eyebrow.textContent = stateLabel(this.language, event.state);
    this.message.textContent = text;
    this.message.hidden = text === "";
    this.file.textContent = visibleFile;
    this.file.hidden = visibleFile === "";
    this.bubble.dataset.kind = isSuccess ? "success" : isError ? "error" : "status";
    this.bubble.dataset.missingCompletionMessage = String(isSuccess && !event.message);
    this.bubble.setAttribute("role", isError ? "alert" : "status");
    this.bubble.setAttribute("aria-live", isError ? "assertive" : "polite");
    this.updateCloseLabel(isError);
    this.bubble.hidden = false;

    this.timer.cancel();
    if (isError) {
      return;
    }
    this.timer.start(
      isSuccess ? SUCCESS_MESSAGE_DURATION_MS : NORMAL_MESSAGE_DURATION_MS,
      () => this.hide(),
    );
    if (this.isEngaged()) {
      this.timer.pause();
    }
  }

  hide(): void {
    this.timer.cancel();
    this.bubble.hidden = true;
    this.displayedEvent = null;
    this.hovered = false;
    this.focused = false;
    this.selecting = false;
  }

  setFileVisibility(visible: boolean, file: string | undefined): void {
    this.file.textContent = visible && file ? file : "";
    this.file.hidden = this.file.textContent === "";
    if (!this.bubble.hidden && this.file.hidden && this.message.hidden) {
      this.hide();
    }
  }

  private updateCloseLabel(isError: boolean): void {
    const label = translate(this.language, isError ? "acknowledgeError" : "closeMessage");
    this.closeButton.setAttribute("aria-label", label);
    this.closeButton.title = label;
  }

  private resumeIfUnengaged(): void {
    if (!this.isEngaged()) {
      this.timer.resume();
    }
  }

  private isEngaged(): boolean {
    return this.hovered || this.focused || this.selecting;
  }

  private readonly handleManualClose = (): void => {
    const event = this.displayedEvent;
    if (event?.state === "success") {
      this.dismissedSuccessEvent = event;
    }
    const acknowledgeError = event?.state === "error";
    this.hide();
    if (acknowledgeError) {
      this.onErrorAcknowledged();
    }
  };

  private readonly handleSelectionChange = (): void => {
    const selection = document.getSelection();
    const anchorInside = selection?.anchorNode ? this.bubble.contains(selection.anchorNode) : false;
    const focusInside = selection?.focusNode ? this.bubble.contains(selection.focusNode) : false;
    this.selecting =
      !this.bubble.hidden && selection !== null && !selection.isCollapsed && (anchorInside || focusInside);
    if (this.selecting) {
      this.timer.pause();
    } else {
      this.resumeIfUnengaged();
    }
  };
}
