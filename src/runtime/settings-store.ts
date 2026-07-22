import { invoke, isTauri } from "@tauri-apps/api/core";

import { DEFAULT_SETTINGS, normalizeSettings, type AppSettings } from "../domain/settings";

const BROWSER_KEY = "furry-agent-pet.settings";

export class SettingsRepository {
  async load(): Promise<AppSettings> {
    if (!isTauri()) {
      return loadBrowserSettings();
    }

    return normalizeSettings(await invoke<unknown>("load_app_settings"));
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const normalized = normalizeSettings(settings);

    if (!isTauri()) {
      localStorage.setItem(BROWSER_KEY, JSON.stringify(normalized));
      return normalized;
    }

    return normalizeSettings(await invoke<unknown>("save_app_settings", { settings: normalized }));
  }

  async reset(onboardingVersion = 0): Promise<AppSettings> {
    if (isTauri()) {
      return normalizeSettings(
        await invoke<unknown>("reset_app_settings", { onboardingVersion }),
      );
    }
    return this.save({ ...DEFAULT_SETTINGS, onboardingVersion });
  }
}

function loadBrowserSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(BROWSER_KEY);
    return normalizeSettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
