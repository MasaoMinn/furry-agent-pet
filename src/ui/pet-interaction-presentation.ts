import type { LoadedPetPackage } from "../domain/pet-package";

export interface PetInteractionPresentation {
  interactionId: string | null;
  animationId: string | null;
  fallbackEffectId: string | null;
}

export function resolvePetInteractionDurationMs(
  petPackage: LoadedPetPackage,
  interactionId: string,
  defaultDurationMs: number,
): number {
  return petPackage.manifest.interactions[interactionId]?.durationMs ?? defaultDurationMs;
}

export function resolvePetInteractionPresentation(
  petPackage: LoadedPetPackage,
  interactionId: string | null,
): PetInteractionPresentation {
  if (!interactionId) {
    return { interactionId: null, animationId: null, fallbackEffectId: null };
  }
  const action = petPackage.manifest.interactions[interactionId];
  return {
    interactionId,
    animationId: action?.animation ?? null,
    fallbackEffectId: action ? null : interactionId,
  };
}
