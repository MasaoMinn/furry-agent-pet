import { describe, expect, it } from "vitest";

import { petPackageOptionLabel } from "./pet-package-option-label";

describe("petPackageOptionLabel", () => {
  it("shows the bundled Furry AI State name without a version", () => {
    expect(petPackageOptionLabel("Furry AI State", "0.2.0", "bundled")).toBe(
      "Furry AI State",
    );
  });

  it("keeps origin and version details for imported packages", () => {
    expect(petPackageOptionLabel("Custom Pet", "1.2.3", "imported")).toBe(
      "本地 · Custom Pet · v1.2.3",
    );
  });

  it("localizes imported package origin details in English", () => {
    expect(petPackageOptionLabel("Custom Pet", "1.2.3", "imported", "en")).toBe(
      "Local · Custom Pet · v1.2.3",
    );
  });
});
