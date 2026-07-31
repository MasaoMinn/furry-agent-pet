const feedbackTimers = new WeakMap<HTMLButtonElement, number>();

export function resetCopyButtonFeedback(button: HTMLButtonElement, label: string): void {
  const timer = feedbackTimers.get(button);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    feedbackTimers.delete(button);
  }
  button.textContent = label;
  delete button.dataset.defaultLabel;
  delete button.dataset.copyState;
}

export function showCopyButtonFeedback(
  button: HTMLButtonElement,
  outcome: "success" | "error",
  labels: { success: string; error: string; fallback: string } = {
    success: "已复制",
    error: "复制失败",
    fallback: "复制",
  },
): void {
  const defaultLabel = button.dataset.defaultLabel ?? button.textContent?.trim() ?? labels.fallback;
  button.dataset.defaultLabel = defaultLabel;
  const existingTimer = feedbackTimers.get(button);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  button.textContent = outcome === "success" ? labels.success : labels.error;
  button.dataset.copyState = outcome;
  const timer = window.setTimeout(() => {
    button.textContent = defaultLabel;
    delete button.dataset.copyState;
    feedbackTimers.delete(button);
  }, 1_600);
  feedbackTimers.set(button, timer);
}
