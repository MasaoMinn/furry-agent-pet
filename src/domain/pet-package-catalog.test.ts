// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

import { AGENT_STATES } from "./agent-state";
import { loadPetPackageCatalog, resolvePetAnimation, selectPetPackage } from "./pet-package";

const BUNDLED_PETS_ROOT = resolve(process.cwd(), "public", "pets");

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
};

describe("pet package catalog", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads every entry from the real bundled catalog through the production loader", async () => {
    const expectedIndex = JSON.parse(
      readFileSync(resolve(BUNDLED_PETS_ROOT, "index.json"), "utf8"),
    ) as { defaultPackageId: string; packages: Array<{ id: string; manifest: string }> };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = new URL(String(input));
        if (url.origin !== "http://localhost:3000" || !url.pathname.startsWith("/pets/")) {
          return { ok: false, status: 404, json: async () => undefined };
        }
        const relativePath = decodeURIComponent(url.pathname.slice("/pets/".length));
        const filePath = resolve(BUNDLED_PETS_ROOT, relativePath);
        const escapedRoot = relative(BUNDLED_PETS_ROOT, filePath).match(/^\.\.(?:[\\/]|$)/);
        if (escapedRoot || !filePath.endsWith(".json") || !existsSync(filePath)) {
          return { ok: false, status: 404, json: async () => undefined };
        }
        return {
          ok: true,
          status: 200,
          json: async () => JSON.parse(readFileSync(filePath, "utf8")),
        };
      }),
    );

    const catalog = await loadPetPackageCatalog();

    expect(catalog.defaultPackageId).toBe(expectedIndex.defaultPackageId);
    expect(catalog.packages.map(({ catalogId }) => catalogId)).toEqual(
      expectedIndex.packages.map(({ id }) => id),
    );
    expect(catalog.warnings).toEqual([]);
    for (const petPackage of catalog.packages) {
      for (const state of AGENT_STATES) {
        const animation = resolvePetAnimation(petPackage, state);
        expect(animation.url).toMatch(/^http:\/\/localhost:3000\/pets\/.+\.(?:gif|png|webp)$/);
      }
    }
  });

  it("isolates a broken manifest and falls back to the first valid package", async () => {
    const requestedUrls: string[] = [];
    const resources = new Map<string, unknown>([
      [
        "http://localhost:3000/pets/index.json",
        {
          schemaVersion: 1,
          defaultPackageId: "broken",
          packages: [
            { id: "broken", manifest: "broken/pet.json" },
            { id: "test-pet", manifest: "test-pet/pet.json" },
          ],
        },
      ],
      ["http://localhost:3000/pets/broken/pet.json", { schemaVersion: 99 }],
      ["http://localhost:3000/pets/test-pet/pet.json", validManifest],
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        requestedUrls.push(url);
        const resource = resources.get(url);
        return {
          ok: resource !== undefined,
          status: resource === undefined ? 404 : 200,
          json: async () => resource,
        };
      }),
    );

    const catalog = await loadPetPackageCatalog();

    expect(catalog.defaultPackageId).toBe("test-pet");
    expect(catalog.packages.map(({ manifest }) => manifest.id)).toEqual(["test-pet"]);
    expect(catalog.warnings).toHaveLength(1);
    expect(selectPetPackage(catalog).manifest.id).toBe("test-pet");
    expect(requestedUrls.every((url) => url.endsWith(".json"))).toBe(true);
  });
});
