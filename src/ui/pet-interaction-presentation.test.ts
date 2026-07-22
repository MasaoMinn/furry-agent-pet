import { describe, expect, it } from "vitest";

import { validatePetPackageManifest, type LoadedPetPackage } from "../domain/pet-package";
import {
  resolvePetInteractionDurationMs,
  resolvePetInteractionPresentation,
} from "./pet-interaction-presentation";

const petPackage: LoadedPetPackage = {
  catalogId: "test",
  source: "bundled",
  manifest: validatePetPackageManifest({
    schemaVersion: 1,
    id: "test",
    name: "Test",
    version: "1",
    author: "Test Author",
    license: "Test-only",
    canvas: { width: 1, height: 1, fit: "contain", anchor: { x: 0.5, y: 1 } },
    animations: {
      idle: { source: "idle.gif", mediaType: "image/gif", loop: true, alt: "idle" },
      drag: { source: "drag.gif", mediaType: "image/gif", loop: true, alt: "drag" },
    },
    states: {
      idle: "idle",
      thinking: "idle",
      planning: "idle",
      coding: "idle",
      testing: "idle",
      success: "idle",
      error: "idle",
    },
    interactions: {
      dragging: { animation: "drag" },
      petting: { animation: "drag", durationMs: 1_200 },
    },
    fallbackAnimation: "idle",
  }),
  manifestUrl: new URL("https://app.local/pets/test/pet.json"),
};

describe("resolvePetInteractionPresentation", () => {
  it("uses a package animation without stacking the built-in effect", () => {
    expect(resolvePetInteractionPresentation(petPackage, "dragging")).toEqual({
      interactionId: "dragging",
      animationId: "drag",
      fallbackEffectId: null,
    });
  });

  it("uses a named built-in fallback only when the package has no mapping", () => {
    expect(resolvePetInteractionPresentation(petPackage, "clicked")).toEqual({
      interactionId: "clicked",
      animationId: null,
      fallbackEffectId: "clicked",
    });
    expect(resolvePetInteractionPresentation(petPackage, null)).toEqual({
      interactionId: null,
      animationId: null,
      fallbackEffectId: null,
    });
  });

  it("uses a package duration for timed interactions and otherwise keeps the app default", () => {
    expect(resolvePetInteractionDurationMs(petPackage, "petting", 650)).toBe(1_200);
    expect(resolvePetInteractionDurationMs(petPackage, "clicked", 650)).toBe(650);
  });
});
