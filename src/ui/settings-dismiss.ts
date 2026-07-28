const SETTINGS_DISMISS_PROTECTED_SELECTOR =
  "#settings-panel, #onboarding-panel, #pet-drag-handle, .state-chip, #state-bubble";

export function shouldDismissSettingsFromTarget(
  settingsOpen: boolean,
  target: EventTarget | null,
): boolean {
  return (
    settingsOpen &&
    target instanceof Element &&
    target.closest(SETTINGS_DISMISS_PROTECTED_SELECTOR) === null
  );
}
