// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

import { alphaPixelsToRegions, pointerCaptureRegions } from "./pointer-capture-regions";

describe("pointerCaptureRegions", () => {
  it("keeps only visible interactive rectangles and converts them to physical pixels", () => {
    const pet = document.createElement("button");
    const hidden = document.createElement("section");
    hidden.hidden = true;
    vi.spyOn(pet, "getBoundingClientRect").mockReturnValue({
      left: 37.2,
      top: 120.4,
      right: 323.2,
      bottom: 392.4,
      width: 286,
      height: 272,
      x: 37.2,
      y: 120.4,
      toJSON: () => ({}),
    });

    expect(pointerCaptureRegions([pet, hidden], 1.5)).toEqual([
      { left: 55, top: 180, width: 430, height: 409 },
    ]);
  });

  it("uses a safe scale fallback and skips zero-sized elements", () => {
    const empty = document.createElement("div");
    expect(pointerCaptureRegions([empty], Number.NaN)).toEqual([]);
  });

  it("builds compact row bands around opaque pixels instead of the full image box", () => {
    const width = 40;
    const height = 30;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 10; y < 20; y += 1) {
      for (let x = 10; x < 30; x += 1) {
        pixels[(y * width + x) * 4 + 3] = 255;
      }
    }

    expect(alphaPixelsToRegions(pixels, width, height, 10, 20, 0)).toEqual([
      { left: 10, top: 10, width: 20, height: 10 },
    ]);
  });

  it("adds one bounded hit-slop cell around visible pixels", () => {
    const pixels = new Uint8ClampedArray(50 * 50 * 4);
    pixels[(20 * 50 + 20) * 4 + 3] = 255;

    expect(alphaPixelsToRegions(pixels, 50, 50, 10, 20, 1)).toEqual([
      { left: 10, top: 10, width: 30, height: 30 },
    ]);
  });
});
