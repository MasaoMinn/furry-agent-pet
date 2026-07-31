export function isPetClickGesture(
  pointerDownAtMs: number,
  pointerUpAtMs: number,
  movementX: number,
  movementY: number,
  maximumDurationMs: number,
  maximumMovementPx: number,
): boolean {
  const durationMs = pointerUpAtMs - pointerDownAtMs;
  return (
    durationMs >= 0 &&
    durationMs <= maximumDurationMs &&
    Math.hypot(movementX, movementY) <= maximumMovementPx
  );
}

export function isPetNativeClickGesture(
  releasedWithinTimeout: boolean,
  movementX: number,
  movementY: number,
  maximumMovementPx: number,
): boolean {
  return (
    releasedWithinTimeout &&
    Math.hypot(movementX, movementY) <= maximumMovementPx
  );
}
