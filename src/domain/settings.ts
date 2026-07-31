import { AGENT_STATES, type AgentState } from "./agent-state";
import { normalizeLanguage, type AppLanguage } from "./i18n";

export const CURRENT_ONBOARDING_VERSION = 2;

export interface AppSettings {
  language: AppLanguage;
  scale: number;
  opacity: number;
  alwaysOnTop: boolean;
  launchAtStartup: boolean;
  showStateBubble: boolean;
  showFilePath: boolean;
  petPackageId: string;
  stateAnimationOverrides: Partial<Record<AgentState, string>>;
  onboardingVersion: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  language: "zh-CN",
  scale: 1,
  opacity: 1,
  alwaysOnTop: true,
  launchAtStartup: false,
  showStateBubble: true,
  showFilePath: false,
  petPackageId: "furry-ai-state",
  stateAnimationOverrides: {},
  onboardingVersion: 0,
};

export function normalizeSettings(value: unknown): AppSettings {
  const candidate = isRecord(value) ? value : {};

  return {
    language: normalizeLanguage(candidate.language),
    scale: clampNumber(candidate.scale, 0.5, 2, DEFAULT_SETTINGS.scale),
    opacity: clampNumber(candidate.opacity, 0.3, 1, DEFAULT_SETTINGS.opacity),
    alwaysOnTop: booleanOr(candidate.alwaysOnTop, DEFAULT_SETTINGS.alwaysOnTop),
    launchAtStartup: booleanOr(candidate.launchAtStartup, DEFAULT_SETTINGS.launchAtStartup),
    showStateBubble: booleanOr(candidate.showStateBubble, DEFAULT_SETTINGS.showStateBubble),
    // Retained in the DTO for Store compatibility, but no longer user-configurable or rendered.
    showFilePath: false,
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
