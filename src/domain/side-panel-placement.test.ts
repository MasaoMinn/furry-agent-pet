import { describe, expect, it } from "vitest";

import { resolveSidePanelLayout } from "./side-panel-placement";

const BASE_INPUT = {
  currentWindowLeft: 400,
  petWidth: 360,
  panelWidth: 328,
  workAreaLeft: 0,
  workAreaWidth: 1_920,
  panelOpen: true,
  previousPanelOpen: false,
  previousPlacement: "right" as const,
};

describe("resolveSidePanelLayout", () => {
  it("opens on the right when the complete window fits", () => {
    expect(resolveSidePanelLayout(BASE_INPUT)).toMatchObject({
      placement: "right",
      windowLeft: 400,
    });
  });

  it("opens on the left when the pet is beside the right work-area edge", () => {
    expect(
      resolveSidePanelLayout({ ...BASE_INPUT, currentWindowLeft: 1_560 }),
    ).toMatchObject({ placement: "left", windowLeft: 1_232, petLeft: 1_560 });
  });

  it("handles monitors with negative desktop coordinates", () => {
    expect(
      resolveSidePanelLayout({
        ...BASE_INPUT,
        currentWindowLeft: -360,
        workAreaLeft: -1_920,
      }),
    ).toMatchObject({ placement: "left", windowLeft: -688 });
  });

  it("restores the pet anchor when a left-hand panel closes", () => {
    expect(
      resolveSidePanelLayout({
        ...BASE_INPUT,
        currentWindowLeft: 1_232,
        panelOpen: false,
        previousPanelOpen: true,
        previousPlacement: "left",
      }),
    ).toMatchObject({ windowLeft: 1_560, petLeft: 1_560 });
  });

  it("clamps the full window into the work area when neither side fits in place", () => {
    expect(
      resolveSidePanelLayout({
        ...BASE_INPUT,
        currentWindowLeft: 300,
        workAreaWidth: 700,
      }),
    ).toMatchObject({ placement: "left", windowLeft: 0 });
  });
});
