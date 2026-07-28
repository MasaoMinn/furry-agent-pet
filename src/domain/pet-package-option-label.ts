import type { LoadedPetPackage } from "./pet-package";

export function petPackageOptionLabel(
  name: string,
  version: string,
  source: LoadedPetPackage["source"],
): string {
  return source === "imported" ? `本地 · ${name} · v${version}` : name;
}
