import type { LoadedPetPackage } from "./pet-package";
import { translate, type AppLanguage } from "./i18n";

export function petPackageOptionLabel(
  name: string,
  version: string,
  source: LoadedPetPackage["source"],
  language: AppLanguage = "zh-CN",
): string {
  return source === "imported"
    ? translate(language, "localPackage", { name, version })
    : name;
}
