import { describe, expect, it } from "vitest";

import { fitPreviewDimensions } from "./action-preview-poster";

describe("fitPreviewDimensions", () => {
  it("preserves the aspect ratio while bounding large previews", () => {
    expect(fitPreviewDimensions(576, 530)).toEqual({ width: 130, height: 120 });
    expect(fitPreviewDimensions(800, 400)).toEqual({ width: 160, height: 80 });
  });

  it("does not upscale small images", () => {
    expect(fitPreviewDimensions(64, 48)).toEqual({ width: 64, height: 48 });
  });

  it("returns a safe minimum for invalid dimensions", () => {
    expect(fitPreviewDimensions(0, 100)).toEqual({ width: 1, height: 1 });
  });
});
