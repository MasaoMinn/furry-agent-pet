// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { shouldDismissSettingsFromTarget } from "./settings-dismiss";

describe("shouldDismissSettingsFromTarget", () => {
  it("dismisses only an open settings panel from the pet surroundings", () => {
    const surroundings = document.createElement("div");

    expect(shouldDismissSettingsFromTarget(true, surroundings)).toBe(true);
    expect(shouldDismissSettingsFromTarget(false, surroundings)).toBe(false);
    expect(shouldDismissSettingsFromTarget(true, null)).toBe(false);
  });

  it.each([
    ["settings content", '<section id="settings-panel"><button id="target"></button></section>'],
    ["onboarding content", '<section id="onboarding-panel"><button id="target"></button></section>'],
    ["pet", '<button id="pet-drag-handle"><span id="target"></span></button>'],
    ["state chip", '<div class="state-chip"><button id="target"></button></div>'],
    ["bubble", '<aside id="state-bubble"><button id="target"></button></aside>'],
  ])("keeps settings open for %s", (_label, markup) => {
    document.body.innerHTML = markup;

    expect(
      shouldDismissSettingsFromTarget(true, document.querySelector("#target")),
    ).toBe(false);
  });
});
