const feedbackTimers = new WeakMap<HTMLButtonElement, number>();

export function showCopyButtonFeedback(
  button: HTMLButtonElement,
  outcome: "success" | "error",
): void {
  const defaultLabel = button.dataset.defaultLabel ?? button.textContent?.trim() ?? "复制";
  button.dataset.defaultLabel = defaultLabel;
  const existingTimer = feedbackTimers.get(button);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  button.textContent = outcome === "success" ? "已复制" : "复制失败";
  button.dataset.copyState = outcome;
  const timer = window.setTimeout(() => {
    button.textContent = defaultLabel;
    delete button.dataset.copyState;
    feedbackTimers.delete(button);
  }, 1_600);
  feedbackTimers.set(button, timer);
}
