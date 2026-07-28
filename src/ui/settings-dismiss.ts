const SETTINGS_PANEL_SELECTOR = "#settings-panel";

export function shouldDismissSettingsFromTarget(
  settingsOpen: boolean,
  target: EventTarget | null,
): boolean {
  return (
    settingsOpen &&
    target instanceof Element &&
    target.closest(SETTINGS_PANEL_SELECTOR) === null
  );
}
