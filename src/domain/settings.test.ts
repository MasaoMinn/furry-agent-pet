import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, normalizeSettings } from "./settings";

describe("normalizeSettings", () => {
  it("uses safe defaults for missing values", () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  it("normalizes the Windows startup preference as a boolean", () => {
    expect(normalizeSettings({ launchAtStartup: true }).launchAtStartup).toBe(true);
    expect(normalizeSettings({ launchAtStartup: "yes" }).launchAtStartup).toBe(false);
  });

  it("clamps scale and opacity", () => {
    expect(normalizeSettings({ scale: 9, opacity: 0 })).toMatchObject({
      scale: 2,
      opacity: 0.3,
    });
  });

  it("persists only the supported interface languages", () => {
    expect(normalizeSettings({ language: "en" }).language).toBe("en");
    expect(normalizeSettings({ language: "zh-CN" }).language).toBe("zh-CN");
    expect(normalizeSettings({ language: "fr" }).language).toBe("zh-CN");
  });

  it("drops retired manual motion and IPC preferences", () => {
    const normalized = normalizeSettings({
      reduceMotion: true,
      ipcAddress: "custom.sock",
      ipcEnabled: false,
    });

    expect(normalized).not.toHaveProperty("reduceMotion");
    expect(normalized).not.toHaveProperty("ipcAddress");
    expect(normalized).not.toHaveProperty("ipcEnabled");
  });

  it("drops the retired completion bubble duration", () => {
    const normalized = normalizeSettings({ successBubbleDurationMs: 3_000 });

    expect(normalized).not.toHaveProperty("successBubbleDurationMs");
  });

  it("keeps the retired file-path display disabled", () => {
    expect(normalizeSettings({ showFilePath: true }).showFilePath).toBe(false);
  });

  it("keeps only known state animation overrides", () => {
    expect(
      normalizeSettings({
        stateAnimationOverrides: {
          thinking: "  coding  ",
          error: "",
          unknown: "sleeping",
        },
      }).stateAnimationOverrides,
    ).toEqual({ thinking: "coding" });
  });

  it("accepts only non-negative integer onboarding versions", () => {
    expect(normalizeSettings({ onboardingVersion: 1 }).onboardingVersion).toBe(1);
    expect(normalizeSettings({ onboardingVersion: -1 }).onboardingVersion).toBe(0);
    expect(normalizeSettings({ onboardingVersion: 1.5 }).onboardingVersion).toBe(0);
  });

  it("persists only bounded opaque or bundled pet package ids", () => {
    expect(normalizeSettings({ petPackageId: `local-${"a".repeat(24)}` }).petPackageId).toBe(
      `local-${"a".repeat(24)}`,
    );
    expect(normalizeSettings({ petPackageId: "../../outside" }).petPackageId).toBe(
      DEFAULT_SETTINGS.petPackageId,
    );
    expect(normalizeSettings({ petPackageId: "x".repeat(81) }).petPackageId).toBe(
      DEFAULT_SETTINGS.petPackageId,
    );
  });
});
