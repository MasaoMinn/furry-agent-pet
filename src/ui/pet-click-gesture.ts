export function isPetClickGesture(
  clickDetail: number,
  pointerDownAtMs: number | null,
  clickAtMs: number,
  maximumDurationMs: number,
): boolean {
  if (clickDetail === 0 || pointerDownAtMs === null) {
    return true;
  }
  const durationMs = clickAtMs - pointerDownAtMs;
  return durationMs >= 0 && durationMs <= maximumDurationMs;
}
