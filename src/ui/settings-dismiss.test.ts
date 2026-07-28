// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { shouldDismissSettingsFromTarget } from "./settings-dismiss";

describe("shouldDismissSettingsFromTarget", () => {
  it("dismisses an open settings panel for any element outside it", () => {
    const outside = document.createElement("div");

    expect(shouldDismissSettingsFromTarget(true, outside)).toBe(true);
    expect(shouldDismissSettingsFromTarget(false, outside)).toBe(false);
    expect(shouldDismissSettingsFromTarget(true, null)).toBe(false);
  });

  it("keeps settings open for nested settings content", () => {
    document.body.innerHTML =
      '<section id="settings-panel"><form><button id="target"></button></form></section>';

    expect(
      shouldDismissSettingsFromTarget(true, document.querySelector("#target")),
    ).toBe(false);
  });

  it.each([
    ["onboarding content", '<section id="onboarding-panel"><button id="target"></button></section>'],
    ["pet", '<button id="pet-drag-handle"><span id="target"></span></button>'],
    ["state chip", '<div class="state-chip"><button id="target"></button></div>'],
    ["bubble", '<aside id="state-bubble"><button id="target"></button></aside>'],
    ["transparent surroundings", '<div class="pet-column"><span id="target"></span></div>'],
  ])("dismisses settings for %s", (_label, markup) => {
    document.body.innerHTML = markup;

    expect(
      shouldDismissSettingsFromTarget(true, document.querySelector("#target")),
    ).toBe(true);
  });
});
