// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { validatePetPackageManifest, type LoadedPetPackage } from "../domain/pet-package";
import { PetRenderer } from "./pet-renderer";

describe("PetRenderer", () => {
  it("does not restart a GIF when another state maps to the same animation", () => {
    const image = document.createElement("img");
    let sourceWrites = 0;
    Object.defineProperty(image, "src", {
      configurable: true,
      get: () => "",
      set: () => {
        sourceWrites += 1;
      },
    });

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
        fallbackAnimation: "idle",
      }),
      manifestUrl: new URL("https://app.local/pets/test/pet.json"),
    };
    const renderer = new PetRenderer(image, petPackage);

    expect(renderer.render("idle")).toBe(true);
    expect(renderer.render("thinking")).toBe(false);
    expect(sourceWrites).toBe(1);
  });

  it("falls back to a static image and does not retry a broken animation", () => {
    const image = document.createElement("img");
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
        fallbackAnimation: "idle",
      }),
      manifestUrl: new URL("https://app.local/pets/test/pet.json"),
    };
    const fallbackUrl = "https://app.local/pets/fallback-idle.svg";
    const renderer = new PetRenderer(image, petPackage, fallbackUrl);

    renderer.render("idle");
    image.dispatchEvent(new Event("error"));

    expect(image.src).toBe(fallbackUrl);
    expect(image.alt).toMatch(/备用静态图标/);
    expect(renderer.render("idle")).toBe(false);
    expect(image.src).toBe(fallbackUrl);
  });

  it("reloads an identically named animation after switching packages", () => {
    const image = document.createElement("img");
    let sourceWrites = 0;
    Object.defineProperty(image, "src", {
      configurable: true,
      get: () => "",
      set: () => {
        sourceWrites += 1;
      },
    });
    const manifest = validatePetPackageManifest({
      schemaVersion: 1,
      id: "test",
      name: "Test",
      version: "1",
      author: "Test Author",
      license: "Test-only",
      canvas: { width: 1, height: 1, fit: "contain", anchor: { x: 0.5, y: 1 } },
      animations: {
        idle: { source: "idle.gif", mediaType: "image/gif", loop: true, alt: "idle" },
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
      fallbackAnimation: "idle",
    });
    const renderer = new PetRenderer(image, {
      catalogId: "one",
      source: "bundled",
      manifest,
      manifestUrl: new URL("https://app.local/pets/one/pet.json"),
    });

    renderer.render("idle");
    renderer.setPackage({
      catalogId: "two",
      source: "bundled",
      manifest,
      manifestUrl: new URL("https://app.local/pets/two/pet.json"),
    });
    renderer.render("idle");

    expect(sourceWrites).toBe(2);
  });

  it("renders an interaction animation independently from the current state mapping", () => {
    const image = document.createElement("img");
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
          drag: { source: "drag.gif", mediaType: "image/gif", loop: true, alt: "dragging" },
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
        interactions: { dragging: { animation: "drag" } },
        fallbackAnimation: "idle",
      }),
      manifestUrl: new URL("https://app.local/pets/test/pet.json"),
    };
    const renderer = new PetRenderer(image, petPackage);

    renderer.render("idle");
    expect(image.alt).toBe("idle");
    renderer.renderAnimation(petPackage.manifest.interactions.dragging.animation);
    expect(image.src).toBe("https://app.local/pets/test/drag.gif");
    expect(image.alt).toBe("dragging");
    renderer.render("idle");
    expect(image.src).toBe("https://app.local/pets/test/idle.gif");
  });

  it("uses the static fallback for GIFs while reduced motion is requested and restores the current animation", () => {
    const image = document.createElement("img");
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
          coding: { source: "coding.gif", mediaType: "image/gif", loop: true, alt: "coding" },
        },
        states: {
          idle: "idle",
          thinking: "idle",
          planning: "idle",
          coding: "coding",
          testing: "coding",
          success: "idle",
          error: "idle",
        },
        fallbackAnimation: "idle",
      }),
      manifestUrl: new URL("https://app.local/pets/test/pet.json"),
    };
    const fallbackUrl = "https://app.local/pets/fallback-idle.svg";
    const renderer = new PetRenderer(image, petPackage, fallbackUrl);

    renderer.render("idle");
    expect(image.src).toBe("https://app.local/pets/test/idle.gif");

    expect(renderer.setReducedMotion(true)).toBe(true);
    expect(image.src).toBe(fallbackUrl);
    expect(image.alt).toBe("idle（已减少动态效果）");

    expect(renderer.render("coding")).toBe(false);
    expect(image.src).toBe(fallbackUrl);
    expect(image.alt).toBe("coding（已减少动态效果）");

    expect(renderer.setReducedMotion(false)).toBe(true);
    expect(image.src).toBe("https://app.local/pets/test/coding.gif");
    expect(image.alt).toBe("coding");
  });

  it("keeps static PNG and WebP resources visible in reduced-motion mode", () => {
    const image = document.createElement("img");
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
          idle: { source: "idle.png", mediaType: "image/png", loop: false, alt: "idle" },
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
        fallbackAnimation: "idle",
      }),
      manifestUrl: new URL("https://app.local/pets/test/pet.json"),
    };
    const renderer = new PetRenderer(image, petPackage, "https://app.local/pets/fallback-idle.svg");

    renderer.render("idle");
    expect(renderer.setReducedMotion(true)).toBe(false);
    expect(image.src).toBe("https://app.local/pets/test/idle.png");
    expect(image.alt).toBe("idle");
  });

  it("prefers a package-provided static animation and restores the requested GIF", () => {
    const image = document.createElement("img");
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
          coding: { source: "coding.gif", mediaType: "image/gif", loop: true, alt: "coding" },
          "coding-static": {
            source: "coding-static.webp",
            mediaType: "image/webp",
            loop: false,
            alt: "coding without motion",
          },
        },
        states: {
          idle: "coding",
          thinking: "coding",
          planning: "coding",
          coding: "coding",
          testing: "coding",
          success: "coding",
          error: "coding",
        },
        reducedMotionAnimations: { coding: "coding-static" },
        fallbackAnimation: "coding",
      }),
      manifestUrl: new URL("https://app.local/pets/test/pet.json"),
    };
    const renderer = new PetRenderer(image, petPackage, "https://app.local/pets/fallback-idle.svg");

    renderer.render("coding");
    expect(renderer.setReducedMotion(true)).toBe(true);
    expect(image.src).toBe("https://app.local/pets/test/coding-static.webp");
    expect(image.alt).toBe("coding without motion");

    expect(renderer.setReducedMotion(false)).toBe(true);
    expect(image.src).toBe("https://app.local/pets/test/coding.gif");
    expect(image.alt).toBe("coding");
  });
});
