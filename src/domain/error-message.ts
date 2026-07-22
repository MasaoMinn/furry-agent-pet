const MAX_ERROR_MESSAGE_CHARS = 512;

/**
 * Converts native invoke rejections and ordinary JavaScript errors into a
 * bounded, single-line message suitable for rendering with `textContent`.
 * Tauri commands that return `Err<String>` reject with that string directly,
 * so checking only `instanceof Error` would discard the actionable reason.
 */
export function describeError(error: unknown, fallback = "未知错误"): string {
  const raw = readErrorMessage(error) ?? fallback;
  const normalized = raw.replace(/\s+/gu, " ").trim() || fallback;
  const characters = Array.from(normalized);
  return characters.length <= MAX_ERROR_MESSAGE_CHARS
    ? normalized
    : `${characters.slice(0, MAX_ERROR_MESSAGE_CHARS - 1).join("")}…`;
}

function readErrorMessage(error: unknown): string | null {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return null;
  }

  try {
    return typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : null;
  } catch {
    return null;
  }
}
