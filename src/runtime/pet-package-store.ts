import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

import {
  validatePetPackageManifest,
  type LoadedPetPackage,
} from "../domain/pet-package";

export async function listImportedPetPackages(): Promise<LoadedPetPackage[]> {
  if (!isTauri()) {
    return [];
  }

  const records = await invoke<unknown[]>("list_imported_pet_packages");
  if (!Array.isArray(records)) {
    throw new Error("Imported pet package list is invalid");
  }

  return records.map((record) => toLoadedImportedPetPackage(record));
}

export async function importPetPackage(): Promise<LoadedPetPackage | null> {
  if (!isTauri()) {
    throw new Error("Local pet packages can only be imported in the desktop app");
  }

  const record = await invoke<unknown | null>("import_pet_package");
  return record === null ? null : toLoadedImportedPetPackage(record);
}

export async function removeImportedPetPackage(catalogId: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Local pet packages can only be removed in the desktop app");
  }
  await invoke("remove_imported_pet_package", { catalogId });
}

export function localPetPackageManagementAvailable(): boolean {
  return isTauri();
}

export function toLoadedImportedPetPackage(
  value: unknown,
  pathToAssetUrl: (path: string) => string = convertFileSrc,
): LoadedPetPackage {
  if (!isRecord(value)) {
    throw new Error("Imported pet package record is invalid");
  }

  const catalogId = requireString(value.catalogId, "catalogId");
  if (!/^local-[a-f0-9]{24,64}$/.test(catalogId)) {
    throw new Error("Imported pet package id is invalid");
  }
  const manifestPath = requireString(value.manifestPath, "manifestPath");
  const manifest = validatePetPackageManifest(value.manifest);
  const assetPaths = value.assetPaths;
  if (!isRecord(assetPaths)) {
    throw new Error("Imported pet package assetPaths is invalid");
  }
  const declaredSources = new Set(
    Object.values(manifest.animations).map(({ source }) => source),
  );
  if (
    Object.keys(assetPaths).length !== declaredSources.size ||
    Object.keys(assetPaths).some((source) => !declaredSources.has(source))
  ) {
    throw new Error("Imported pet package assetPaths do not match its manifest");
  }
  const assetUrls = Object.fromEntries(
    [...declaredSources].map((source) => [
      source,
      pathToAssetUrl(requireString(assetPaths[source], `assetPaths.${source}`)),
    ]),
  );
  const manifestUrl = new URL(pathToAssetUrl(manifestPath));

  return {
    catalogId,
    source: "imported",
    manifest,
    manifestUrl,
    assetUrls,
  };
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Imported pet package ${field} is invalid`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
