import { AGENT_STATES, type AgentState } from "./agent-state";

export const CURRENT_ONBOARDING_VERSION = 2;

export interface AppSettings {
  scale: number;
  opacity: number;
  alwaysOnTop: boolean;
  showStateBubble: boolean;
  showFilePath: boolean;
  successBubbleDurationMs: number;
  petPackageId: string;
  stateAnimationOverrides: Partial<Record<AgentState, string>>;
  onboardingVersion: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  scale: 1,
  opacity: 1,
  alwaysOnTop: true,
  showStateBubble: true,
  showFilePath: false,
  successBubbleDurationMs: 15_000,
  petPackageId: "furry-ai-state",
  stateAnimationOverrides: {},
  onboardingVersion: 0,
};

export function normalizeSettings(value: unknown): AppSettings {
  const candidate = isRecord(value) ? value : {};

  return {
    scale: clampNumber(candidate.scale, 0.5, 2, DEFAULT_SETTINGS.scale),
    opacity: clampNumber(candidate.opacity, 0.3, 1, DEFAULT_SETTINGS.opacity),
    alwaysOnTop: booleanOr(candidate.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    showStateBubble: booleanOr(candidate.showStateBubble, DEFAULT_SETTINGS.showStateBubble),
    showFilePath: booleanOr(candidate.showFilePath, DEFAULT_SETTINGS.showFilePath),
    successBubbleDurationMs: clampInteger(
      candidate.successBubbleDurationMs,
      3_000,
      60_000,
      DEFAULT_SETTINGS.successBubbleDurationMs,
    ),
    petPackageId: packageIdOr(candidate.petPackageId, DEFAULT_SETTINGS.petPackageId),
    stateAnimationOverrides: normalizeStateAnimationOverrides(candidate.stateAnimationOverrides),
    onboardingVersion: nonNegativeIntegerOr(
      candidate.onboardingVersion,
      DEFAULT_SETTINGS.onboardingVersion,
    ),
  };
}

function normalizeStateAnimationOverrides(
  value: unknown,
): Partial<Record<AgentState, string>> {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    AGENT_STATES.flatMap((state) => {
      const animationId = value[state];
      const normalized = packageIdOr(animationId, "");
      return normalized && normalized.length <= 64 ? [[state, normalized]] : [];
    }),
  );
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function packageIdOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const packageId = value.trim();
  return packageId.length <= 80 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(packageId)
    ? packageId
    : fallback;
}

function nonNegativeIntegerOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
