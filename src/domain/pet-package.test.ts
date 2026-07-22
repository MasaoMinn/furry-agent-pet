import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolvePetAnimation,
  resolvePetAnimationById,
  validatePetPackageManifest,
  type LoadedPetPackage,
} from "./pet-package";

const validManifest = {
  schemaVersion: 1,
  id: "test-pet",
  name: "Test Pet",
  version: "1.0.0",
  author: "Test Author",
  license: "Test-only",
  canvas: { width: 610, height: 600, fit: "contain", anchor: { x: 0.5, y: 1 } },
  animations: {
    idle: { source: "animations/idle.gif", mediaType: "image/gif", loop: true, alt: "idle" },
    sleep: { source: "animations/sleep.gif", mediaType: "image/gif", loop: true, alt: "sleep" },
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
  stateVariants: {
    idle: [{ animation: "sleep", activateAfterMs: 60_000 }],
  },
  interactions: {
    dragging: { animation: "sleep" },
    clicked: { animation: "sleep", durationMs: 900 },
  },
  fallbackAnimation: "idle",
};

const EXPECTED_BUNDLED_GIF_SHA256: Record<string, string> = {
  "animations/coding.gif": "47736beb18b2013983449fa5b1b45768d390b9e8dd85741ca7ac4eeadcfad795",
  "animations/exhausted.gif": "102118e45e01f83531e4fc98ec1243904accd0fb4e9acf34f61563446bacb4d5",
  "animations/idle.gif": "9affb3c702affd8873a361cf871760c1085ba852c36c9e6132cee60051bb83bb",
  "animations/sleeping.gif": "ef57dcb29efce92da8c67b0f4579c5abeb9fcd652094ccd89d36d8b20ae5dc16",
};

const BUNDLED_PETS_ROOT = fileURLToPath(new URL("../../public/pets/", import.meta.url));

interface BundledPackageIndex {
  schemaVersion: number;
  defaultPackageId: string;
  packages: Array<{ id: string; manifest: string }>;
}

function loadBundledManifest(packageId: string): PetPackageManifestWithPath {
  const index = JSON.parse(
    readFileSync(join(BUNDLED_PETS_ROOT, "index.json"), "utf8"),
  ) as BundledPackageIndex;
  const entry = index.packages.find(({ id }) => id === packageId);
  expect(entry, `catalog entry ${packageId}`).toBeDefined();
  const manifestPath = resolve(BUNDLED_PETS_ROOT, entry!.manifest);
  return {
    manifest: validatePetPackageManifest(JSON.parse(readFileSync(manifestPath, "utf8"))),
    manifestPath,
  };
}

interface PetPackageManifestWithPath {
  manifest: ReturnType<typeof validatePetPackageManifest>;
  manifestPath: string;
}

function listPackageMedia(packageRoot: string, directory = packageRoot): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return listPackageMedia(packageRoot, path);
    }
    if (!entry.isFile() || ![".gif", ".png", ".webp"].includes(extname(entry.name).toLowerCase())) {
      return [];
    }
    return [relative(packageRoot, path).replace(/\\/g, "/")];
  });
}

describe("pet package manifest", () => {
  it("validates every package and referenced asset declared by the bundled catalog", () => {
    const index = JSON.parse(
      readFileSync(join(BUNDLED_PETS_ROOT, "index.json"), "utf8"),
    ) as BundledPackageIndex;
    expect(index.schemaVersion).toBe(1);
    expect(index.packages.length).toBeGreaterThan(0);
    expect(new Set(index.packages.map(({ id }) => id)).size).toBe(index.packages.length);
    expect(index.packages.some(({ id }) => id === index.defaultPackageId)).toBe(true);

    for (const entry of index.packages) {
      const manifestPath = resolve(BUNDLED_PETS_ROOT, entry.manifest);
      expect(relative(BUNDLED_PETS_ROOT, manifestPath)).not.toMatch(/^\.\.(?:[\\/]|$)/);
      const manifest = validatePetPackageManifest(
        JSON.parse(readFileSync(manifestPath, "utf8")),
      );
      expect(manifest.id).toBe(entry.id);
      const packageRoot = dirname(manifestPath);
      expect(listPackageMedia(packageRoot).sort()).toEqual(
        [...new Set(Object.values(manifest.animations).map(({ source }) => source))].sort(),
      );

      for (const animation of Object.values(manifest.animations)) {
        const animationPath = resolve(packageRoot, animation.source);
        expect(relative(packageRoot, animationPath)).not.toMatch(/^\.\.(?:[\\/]|$)/);
        const stats = statSync(animationPath);
        expect(stats.isFile()).toBe(true);
        expect(stats.size).toBeGreaterThan(0);
        expect(stats.size).toBeLessThanOrEqual(10 * 1_024 * 1_024);
      }
    }
  });

  it("keeps the initial four furry-ai-state GIFs and mappings byte-identical", () => {
    const { manifest, manifestPath } = loadBundledManifest("furry-ai-state");
    const expectedAnimationSources = {
      coding: "animations/coding.gif",
      exhausted: "animations/exhausted.gif",
      idle: "animations/idle.gif",
      sleeping: "animations/sleeping.gif",
    };

    for (const [animationId, source] of Object.entries(expectedAnimationSources)) {
      expect(manifest.animations[animationId]?.source).toBe(source);
      const animationPath = join(dirname(manifestPath), source);
      expect(createHash("sha256").update(readFileSync(animationPath)).digest("hex")).toBe(
        EXPECTED_BUNDLED_GIF_SHA256[source],
      );
    }
    expect(manifest.states).toEqual({
      idle: "idle",
      thinking: "idle",
      planning: "idle",
      coding: "coding",
      testing: "coding",
      success: "idle",
      error: "exhausted",
    });
    expect(manifest.stateVariants).toEqual({
      idle: [{ animation: "sleeping", activateAfterMs: 60_000 }],
    });
    expect(manifest.interactions).toEqual({});
    expect(manifest.reducedMotionAnimations).toEqual({});
  });

  it("validates all seven state mappings, delayed variants and interaction actions", () => {
    const manifest = validatePetPackageManifest(validManifest);
    expect(Object.keys(manifest.states)).toHaveLength(7);
    expect(manifest.stateVariants.idle).toEqual([
      { animation: "sleep", activateAfterMs: 60_000 },
    ]);
    expect(manifest.interactions.dragging).toEqual({ animation: "sleep" });
    expect(manifest.interactions.clicked).toEqual({ animation: "sleep", durationMs: 900 });
    expect(manifest.reducedMotionAnimations).toEqual({});
  });

  it("maps GIF actions to validated non-looping static animations for reduced motion", () => {
    const withStaticAnimation = {
      ...structuredClone(validManifest),
      animations: {
        ...structuredClone(validManifest.animations),
        "idle-static": {
          source: "animations/idle-static.png",
          mediaType: "image/png",
          loop: false,
          alt: "idle static",
        },
      },
      reducedMotionAnimations: { idle: "idle-static" },
    };
    expect(validatePetPackageManifest(withStaticAnimation).reducedMotionAnimations).toEqual({
      idle: "idle-static",
    });

    expect(() =>
      validatePetPackageManifest({
        ...withStaticAnimation,
        reducedMotionAnimations: { missing: "idle-static" },
      }),
    ).toThrow(/unknown animation/);
    expect(() =>
      validatePetPackageManifest({
        ...withStaticAnimation,
        reducedMotionAnimations: { idle: "missing" },
      }),
    ).toThrow(/unknown target/);
    expect(() =>
      validatePetPackageManifest({
        ...withStaticAnimation,
        reducedMotionAnimations: { idle: "sleep" },
      }),
    ).toThrow(/non-looping PNG or WebP/);
    expect(() =>
      validatePetPackageManifest({
        ...withStaticAnimation,
        animations: {
          ...withStaticAnimation.animations,
          "idle-static": { ...withStaticAnimation.animations["idle-static"], loop: true },
        },
      }),
    ).toThrow(/non-looping PNG or WebP/);
  });

  it("rejects paths that can escape the package", () => {
    const invalid = structuredClone(validManifest);
    invalid.animations.idle.source = "../outside.gif";
    expect(() => validatePetPackageManifest(invalid)).toThrow(/Unsafe pet asset path/);
  });

  it("rejects encoded and backslash traversal paths", () => {
    for (const source of ["animations/%2e%2e/outside.gif", "animations\\..\\outside.gif"]) {
      const invalid = structuredClone(validManifest);
      invalid.animations.idle.source = source;
      expect(() => validatePetPackageManifest(invalid)).toThrow(/Unsafe pet asset path/);
    }
  });

  it("bounds identifiers, canvas size, animation count and state variants", () => {
    const invalidId = structuredClone(validManifest);
    invalidId.id = "unsafe/local";
    expect(() => validatePetPackageManifest(invalidId)).toThrow(/unsafe characters/);

    const oversizedCanvas = structuredClone(validManifest);
    oversizedCanvas.canvas.width = 2_049;
    expect(() => validatePetPackageManifest(oversizedCanvas)).toThrow(/dimensions are too large/);

    const tooManyAnimations = {
      ...structuredClone(validManifest),
      animations: Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [
          `animation-${index}`,
          { source: `animations/${index}.gif`, mediaType: "image/gif", loop: true, alt: "a" },
        ]),
      ),
    };
    expect(() => validatePetPackageManifest(tooManyAnimations)).toThrow(/too many animations/);

    const tooManyVariants = structuredClone(validManifest);
    tooManyVariants.stateVariants.idle = Array.from({ length: 17 }, (_, index) => ({
      animation: "sleep",
      activateAfterMs: index + 1,
    }));
    expect(() => validatePetPackageManifest(tooManyVariants)).toThrow(/too many entries/);

    const tooManyInteractions = {
      ...structuredClone(validManifest),
      interactions: Object.fromEntries(
        Array.from({ length: 33 }, (_, index) => [
          `interaction-${index}`,
          { animation: "sleep" },
        ]),
      ),
    };
    expect(() => validatePetPackageManifest(tooManyInteractions)).toThrow(
      /too many interaction actions/,
    );
  });

  it("rejects missing and unknown state animation mappings", () => {
    const invalid = structuredClone(validManifest);
    invalid.states.error = "missing";
    expect(() => validatePetPackageManifest(invalid)).toThrow(/unknown animation/);
  });

  it("rejects unsafe interaction ids and unknown interaction animations", () => {
    const unsafeId = structuredClone(validManifest) as Record<string, unknown>;
    unsafeId.interactions = { "drag/../../outside": { animation: "sleep" } };
    expect(() => validatePetPackageManifest(unsafeId)).toThrow(/unsafe characters/);

    const unknownAnimation = structuredClone(validManifest);
    unknownAnimation.interactions.dragging.animation = "missing";
    expect(() => validatePetPackageManifest(unknownAnimation)).toThrow(/unknown animation/);
  });

  it("accepts bounded optional interaction durations and rejects invalid values", () => {
    for (const durationMs of [100, 60_000]) {
      const manifest = structuredClone(validManifest);
      manifest.interactions.clicked.durationMs = durationMs;
      expect(validatePetPackageManifest(manifest).interactions.clicked.durationMs).toBe(durationMs);
    }

    for (const durationMs of [99, 60_001, 500.5]) {
      const manifest = structuredClone(validManifest);
      manifest.interactions.clicked.durationMs = durationMs;
      expect(() => validatePetPackageManifest(manifest)).toThrow(/durationMs/);
    }
  });

  it("requires explicit author and license metadata", () => {
    const missingAuthor = structuredClone(validManifest) as Record<string, unknown>;
    delete missingAuthor.author;
    expect(() => validatePetPackageManifest(missingAuthor)).toThrow(/author/);

    const missingLicense = structuredClone(validManifest) as Record<string, unknown>;
    delete missingLicense.license;
    expect(() => validatePetPackageManifest(missingLicense)).toThrow(/license/);
  });

  it("resolves relative assets against the manifest URL", () => {
    const manifest = validatePetPackageManifest(validManifest);
    const petPackage: LoadedPetPackage = {
      catalogId: "test-pet",
      source: "bundled",
      manifest,
      manifestUrl: new URL("https://app.local/pets/test-pet/pet.json"),
    };
    expect(resolvePetAnimation(petPackage, "idle").url).toBe(
      "https://app.local/pets/test-pet/animations/idle.gif",
    );
    expect(resolvePetAnimation(petPackage, "idle", "sleep").id).toBe("sleep");
    expect(resolvePetAnimationById(petPackage, "sleep").id).toBe("sleep");
  });

  it("ignores a stale override and uses the state mapping", () => {
    const mappedManifest = structuredClone(validManifest);
    mappedManifest.states.coding = "sleep";
    const petPackage: LoadedPetPackage = {
      catalogId: "test-pet",
      source: "bundled",
      manifest: validatePetPackageManifest(mappedManifest),
      manifestUrl: new URL("https://app.local/pets/test-pet/pet.json"),
    };

    expect(resolvePetAnimation(petPackage, "coding", "removed-animation").id).toBe("sleep");
  });

});
