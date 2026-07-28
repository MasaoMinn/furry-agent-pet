import { AGENT_STATES, type AgentState } from "./agent-state";

export interface PetAnimation {
  source: string;
  mediaType: "image/gif" | "image/png" | "image/webp";
  loop: boolean;
  alt: string;
}

export interface PetPackageManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  author: string;
  license: string;
  canvas: {
    width: number;
    height: number;
    fit: "contain" | "cover";
    anchor: { x: number; y: number };
  };
  animations: Record<string, PetAnimation>;
  states: Record<AgentState, string>;
  stateAnimationChoices: Record<AgentState, string[]>;
  stateVariants: Partial<Record<AgentState, PetStateVariant[]>>;
  interactions: Record<string, PetInteractionAction>;
  reducedMotionAnimations: Record<string, string>;
  fallbackAnimation: string;
}

export interface PetStateVariant {
  animation: string;
  activateAfterMs: number;
}

export interface PetInteractionAction {
  animation: string;
  durationMs?: number;
}

interface PetPackageIndex {
  schemaVersion: 1;
  defaultPackageId: string;
  packages: Array<{ id: string; manifest: string }>;
}

export interface PetPackageCatalog {
  defaultPackageId: string;
  packages: LoadedPetPackage[];
  warnings: Array<{ packageId: string; message: string }>;
}

export interface LoadedPetPackage {
  catalogId: string;
  source: "bundled" | "imported";
  manifest: PetPackageManifest;
  manifestUrl: URL;
  assetUrls?: Readonly<Record<string, string>>;
}

export interface ResolvedPetAnimation extends PetAnimation {
  id: string;
  url: string;
}

const SUPPORTED_MEDIA_TYPES = new Set(["image/gif", "image/png", "image/webp"]);

export async function loadPetPackage(packageId?: string): Promise<LoadedPetPackage> {
  const catalog = await loadPetPackageCatalog();
  return selectPetPackage(catalog, packageId);
}

export async function loadPetPackageCatalog(): Promise<PetPackageCatalog> {
  const indexUrl = new URL("pets/index.json", document.baseURI);
  const index = validatePackageIndex(await fetchJson(indexUrl));
  const results = await Promise.allSettled(
    index.packages.map(async (packageEntry) => {
      assertSafeRelativePath(packageEntry.manifest);
      const manifestUrl = new URL(packageEntry.manifest, indexUrl);
      const manifest = validatePetPackageManifest(await fetchJson(manifestUrl));

      if (manifest.id !== packageEntry.id) {
        throw new Error(`Pet package id mismatch: expected ${packageEntry.id}`);
      }

      return {
        catalogId: manifest.id,
        source: "bundled" as const,
        manifest,
        manifestUrl,
      };
    }),
  );
  const packages = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
  const warnings = results.flatMap((result, indexPosition) =>
    result.status === "rejected"
      ? [
          {
            packageId: index.packages[indexPosition].id,
            message: errorMessage(result.reason),
          },
        ]
      : [],
  );

  if (packages.length === 0) {
    throw new Error(`No valid pet packages are available: ${warnings.map(({ message }) => message).join("; ")}`);
  }

  const defaultPackageId = packages.some(({ catalogId }) => catalogId === index.defaultPackageId)
    ? index.defaultPackageId
    : packages[0].catalogId;
  return { defaultPackageId, packages, warnings };
}

export function selectPetPackage(
  catalog: PetPackageCatalog,
  packageId?: string,
): LoadedPetPackage {
  const selectedId = packageId ?? catalog.defaultPackageId;
  const selectedPackage = catalog.packages.find(({ catalogId }) => catalogId === selectedId);

  if (!selectedPackage) {
    throw new Error(`Unknown pet package: ${selectedId}`);
  }

  return selectedPackage;
}

export function resolvePetAnimation(
  petPackage: LoadedPetPackage,
  state: AgentState,
  animationOverride?: string,
): ResolvedPetAnimation {
  const mappedAnimation =
    animationOverride && petPackage.manifest.stateAnimationChoices[state].includes(animationOverride)
      ? animationOverride
      : petPackage.manifest.states[state];
  return resolvePetAnimationById(petPackage, mappedAnimation);
}

export function resolvePetAnimationById(
  petPackage: LoadedPetPackage,
  animationId: string,
): ResolvedPetAnimation {
  const id = petPackage.manifest.animations[animationId]
    ? animationId
    : petPackage.manifest.fallbackAnimation;
  const animation = petPackage.manifest.animations[id];

  if (!animation) {
    throw new Error(`Pet package ${petPackage.manifest.id} has no usable fallback animation`);
  }

  return {
    ...animation,
    id,
    url:
      petPackage.assetUrls?.[animation.source] ??
      new URL(animation.source, petPackage.manifestUrl).href,
  };
}

export function validatePetPackageManifest(value: unknown): PetPackageManifest {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("Unsupported pet package schema");
  }

  const id = requireIdentifier(value.id, "id");
  const name = requireString(value.name, "name", 128);
  const version = requireString(value.version, "version", 64);
  const author = requireString(value.author, "author", 128);
  const license = requireString(value.license, "license", 128);
  const canvas = validateCanvas(value.canvas);
  const animations = validateAnimations(value.animations);
  const fallbackAnimation = requireIdentifier(value.fallbackAnimation, "fallbackAnimation");

  if (!animations[fallbackAnimation]) {
    throw new Error("Pet package fallbackAnimation does not exist");
  }

  const rawStates = value.states;
  if (!isRecord(rawStates)) {
    throw new Error("Pet package states must be an object");
  }

  const states = Object.fromEntries(
    AGENT_STATES.map((state) => {
      const animationId = requireIdentifier(rawStates[state], `states.${state}`);
      if (!animations[animationId]) {
        throw new Error(`Pet package state ${state} references an unknown animation`);
      }
      return [state, animationId];
    }),
  ) as Record<AgentState, string>;
  const stateAnimationChoices = validateStateAnimationChoices(
    value.stateAnimationChoices,
    animations,
    states,
  );

  return {
    schemaVersion: 1,
    id,
    name,
    version,
    author,
    license,
    ...optionalStringFields(value, [["description", 1_024]]),
    canvas,
    animations,
    states,
    stateAnimationChoices,
    stateVariants: validateStateVariants(value.stateVariants, animations, stateAnimationChoices),
    interactions: validateInteractionActions(value.interactions, animations),
    reducedMotionAnimations: validateReducedMotionAnimations(
      value.reducedMotionAnimations,
      animations,
    ),
    fallbackAnimation,
  };
}

function validateStateAnimationChoices(
  value: unknown,
  animations: Record<string, PetAnimation>,
  states: Record<AgentState, string>,
): Record<AgentState, string[]> {
  if (value === undefined) {
    return Object.fromEntries(
      AGENT_STATES.map((state) => [state, [states[state]]]),
    ) as Record<AgentState, string[]>;
  }
  if (!isRecord(value)) {
    throw new Error("Pet package stateAnimationChoices must be an object");
  }
  if (Object.keys(value).some((state) => !AGENT_STATES.includes(state as AgentState))) {
    throw new Error("Pet package stateAnimationChoices contains an unknown Agent state");
  }

  const choices = Object.fromEntries(
    AGENT_STATES.map((state) => {
      const entries = value[state];
      if (!Array.isArray(entries) || entries.length === 0 || entries.length > 16) {
        throw new Error(`Pet package stateAnimationChoices.${state} must contain 1 to 16 entries`);
      }
      const animationIds = entries.map((entry, index) => {
        const animationId = requireIdentifier(
          entry,
          `stateAnimationChoices.${state}.${index}`,
        );
        if (!animations[animationId]) {
          throw new Error(
            `Pet package stateAnimationChoices.${state} references an unknown animation`,
          );
        }
        return animationId;
      });
      if (new Set(animationIds).size !== animationIds.length) {
        throw new Error(`Pet package stateAnimationChoices.${state} contains duplicates`);
      }
      if (!animationIds.includes(states[state])) {
        throw new Error(
          `Pet package stateAnimationChoices.${state} must include its default animation`,
        );
      }
      return [state, animationIds];
    }),
  ) as Record<AgentState, string[]>;
  if (Object.values(choices).reduce((total, entries) => total + entries.length, 0) > 64) {
    throw new Error("Pet package has too many state animation choices");
  }
  return choices;
}

function validateReducedMotionAnimations(
  value: unknown,
  animations: Record<string, PetAnimation>,
): Record<string, string> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("Pet package reducedMotionAnimations must be an object");
  }

  return Object.fromEntries(
    Object.entries(value).map(([animationId, reducedMotionAnimation]) => {
      requireIdentifier(animationId, `reducedMotionAnimations.${animationId}.id`);
      const sourceAnimation = animations[animationId];
      if (!sourceAnimation) {
        throw new Error(`Reduced-motion mapping ${animationId} references an unknown animation`);
      }
      if (sourceAnimation.mediaType !== "image/gif") {
        throw new Error(`Reduced-motion mapping ${animationId} source must be a GIF`);
      }

      const targetId = requireIdentifier(
        reducedMotionAnimation,
        `reducedMotionAnimations.${animationId}`,
      );
      const targetAnimation = animations[targetId];
      if (!targetAnimation) {
        throw new Error(`Reduced-motion mapping ${animationId} references an unknown target`);
      }
      if (targetAnimation.mediaType === "image/gif" || targetAnimation.loop) {
        throw new Error(`Reduced-motion mapping ${animationId} target must be a non-looping PNG or WebP`);
      }
      return [animationId, targetId];
    }),
  );
}

function validateInteractionActions(
  value: unknown,
  animations: Record<string, PetAnimation>,
): Record<string, PetInteractionAction> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("Pet package interactions must be an object");
  }
  if (Object.keys(value).length > 32) {
    throw new Error("Pet package has too many interaction actions");
  }

  return Object.fromEntries(
    Object.entries(value).map(([interactionId, action]) => {
      requireIdentifier(interactionId, `interactions.${interactionId}.id`);
      if (!isRecord(action)) {
        throw new Error(`Pet package interaction ${interactionId} is invalid`);
      }
      const animation = requireIdentifier(
        action.animation,
        `interactions.${interactionId}.animation`,
      );
      if (!animations[animation]) {
        throw new Error(`Pet package interaction ${interactionId} references an unknown animation`);
      }
      const durationMs =
        action.durationMs === undefined
          ? undefined
          : requireIntegerInRange(
              action.durationMs,
              `interactions.${interactionId}.durationMs`,
              100,
              60_000,
            );
      return [interactionId, durationMs === undefined ? { animation } : { animation, durationMs }];
    }),
  );
}

function validateStateVariants(
  value: unknown,
  animations: Record<string, PetAnimation>,
  stateAnimationChoices: Record<AgentState, string[]>,
): Partial<Record<AgentState, PetStateVariant[]>> {
  if (value === undefined) {
    return {};
  }
  if (!isRecord(value)) {
    throw new Error("Pet package stateVariants must be an object");
  }

  const variantsByState = Object.fromEntries(
    AGENT_STATES.flatMap((state) => {
      const entries = value[state];
      if (entries === undefined) {
        return [];
      }
      if (!Array.isArray(entries)) {
        throw new Error(`Pet package stateVariants.${state} must be an array`);
      }

      const variants = entries.map((entry) => {
        if (!isRecord(entry)) {
          throw new Error(`Pet package stateVariants.${state} has an invalid entry`);
        }
        const animation = requireIdentifier(entry.animation, `stateVariants.${state}.animation`);
        if (!animations[animation]) {
          throw new Error(`Pet package stateVariants.${state} references an unknown animation`);
        }
        if (!stateAnimationChoices[state].includes(animation)) {
          throw new Error(
            `Pet package stateVariants.${state} references an animation from another state`,
          );
        }
        const activateAfterMs = requirePositiveInteger(
          entry.activateAfterMs,
          `stateVariants.${state}.activateAfterMs`,
        );
        if (activateAfterMs > 86_400_000) {
          throw new Error(`Pet package stateVariants.${state}.activateAfterMs is too large`);
        }
        return { animation, activateAfterMs };
      });
      if (variants.length > 16) {
        throw new Error(`Pet package stateVariants.${state} has too many entries`);
      }
      variants.sort((left, right) => left.activateAfterMs - right.activateAfterMs);
      return [[state, variants]];
    }),
  ) as Partial<Record<AgentState, PetStateVariant[]>>;
  const totalVariants = Object.values(variantsByState).reduce(
    (total, variants) => total + variants.length,
    0,
  );
  if (totalVariants > 64) {
    throw new Error("Pet package has too many state variants");
  }
  return variantsByState;
}

function validatePackageIndex(value: unknown): PetPackageIndex {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.defaultPackageId !== "string" ||
    !Array.isArray(value.packages)
  ) {
    throw new Error("Invalid pet package index");
  }

  const packages = value.packages.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error("Invalid pet package index entry");
    }
    return {
      id: requireIdentifier(entry.id, "packages.id"),
      manifest: requireString(entry.manifest, "packages.manifest", 256),
    };
  });

  if (packages.length === 0) {
    throw new Error("Pet package index must not be empty");
  }
  if (packages.length > 32) {
    throw new Error("Pet package index contains too many packages");
  }
  if (new Set(packages.map(({ id }) => id)).size !== packages.length) {
    throw new Error("Pet package index contains duplicate ids");
  }
  if (!packages.some(({ id }) => id === value.defaultPackageId)) {
    throw new Error("Pet package index defaultPackageId does not exist");
  }

  return {
    schemaVersion: 1,
    defaultPackageId: value.defaultPackageId,
    packages,
  };
}

function validateCanvas(value: unknown): PetPackageManifest["canvas"] {
  if (!isRecord(value) || !isRecord(value.anchor)) {
    throw new Error("Pet package canvas is invalid");
  }

  const width = requirePositiveInteger(value.width, "canvas.width");
  const height = requirePositiveInteger(value.height, "canvas.height");
  if (width > 2_048 || height > 2_048) {
    throw new Error("Pet package canvas dimensions are too large");
  }
  if (value.fit !== "contain" && value.fit !== "cover") {
    throw new Error("Pet package canvas.fit is invalid");
  }
  const fit = value.fit;
  const x = requireUnitNumber(value.anchor.x, "canvas.anchor.x");
  const y = requireUnitNumber(value.anchor.y, "canvas.anchor.y");

  return { width, height, fit, anchor: { x, y } };
}

function validateAnimations(value: unknown): Record<string, PetAnimation> {
  if (!isRecord(value) || Object.keys(value).length === 0) {
    throw new Error("Pet package animations must not be empty");
  }
  if (Object.keys(value).length > 64) {
    throw new Error("Pet package has too many animations");
  }

  return Object.fromEntries(
    Object.entries(value).map(([id, animation]) => {
      requireIdentifier(id, `animations.${id}.id`);
      if (!isRecord(animation)) {
        throw new Error(`Pet animation ${id} is invalid`);
      }

      const source = requireString(animation.source, `animations.${id}.source`, 256);
      assertSafeRelativePath(source);
      const mediaType = requireString(animation.mediaType, `animations.${id}.mediaType`);

      if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
        throw new Error(`Pet animation ${id} has an unsupported media type`);
      }
      if (typeof animation.loop !== "boolean") {
        throw new Error(`Pet animation ${id} loop must be a boolean`);
      }

      return [
        id,
        {
          source,
          mediaType: mediaType as PetAnimation["mediaType"],
          loop: animation.loop,
          alt: requireString(animation.alt, `animations.${id}.alt`, 256),
        },
      ];
    }),
  );
}

function assertSafeRelativePath(path: string): void {
  if (path.includes("%") || path.includes("\\")) {
    throw new Error(`Unsafe pet asset path: ${path}`);
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    throw new Error(`Unsafe pet asset path: ${path}`);
  }
  const normalized = decoded.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes(":") ||
    normalized.includes("?") ||
    normalized.includes("#") ||
    normalized
      .split("/")
      .some((segment) => segment === ".." || segment === "." || segment === "")
  ) {
    throw new Error(`Unsafe pet asset path: ${path}`);
  }
}

function optionalStringFields(
  value: Record<string, unknown>,
  fields: Array<[key: string, maxLength: number]>,
): Record<string, string> {
  return Object.fromEntries(
    fields.flatMap(([key, maxLength]) =>
      value[key] === undefined ? [] : [[key, requireString(value[key], key, maxLength)]],
    ),
  );
}

function requireString(value: unknown, field: string, maxLength = 128): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Pet package ${field} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new Error(`Pet package ${field} is too long`);
  }
  return trimmed;
}

function requireIdentifier(value: unknown, field: string): string {
  const identifier = requireString(value, field, 64);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(identifier)) {
    throw new Error(`Pet package ${field} contains unsafe characters`);
  }
  return identifier;
}

function requirePositiveNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Pet package ${field} must be a positive number`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, field: string): number {
  const number = requirePositiveNumber(value, field);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Pet package ${field} must be an integer`);
  }
  return number;
}

function requireIntegerInRange(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): number {
  const number = requirePositiveInteger(value, field);
  if (number < minimum || number > maximum) {
    throw new Error(`Pet package ${field} must be between ${minimum} and ${maximum}`);
  }
  return number;
}

function requireUnitNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Pet package ${field} must be between 0 and 1`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchJson(url: URL): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load pet package resource: ${response.status}`);
  }
  return response.json() as Promise<unknown>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
