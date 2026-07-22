import {
  AGENT_STATES,
  parseAgentStateEvent,
  STATE_PRESENTATION,
  type AgentState,
  type AgentStateEvent,
} from "./domain/agent-state";
import {
  loadPetPackageCatalog,
  selectPetPackage,
  type LoadedPetPackage,
  type PetPackageCatalog,
} from "./domain/pet-package";
import {
  CURRENT_ONBOARDING_VERSION,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from "./domain/settings";
import { describeError } from "./domain/error-message";
import { AGENT_CONNECTION_PROMPT } from "./domain/agent-connection-prompt";
import { SettingsRepository } from "./runtime/settings-store";
import {
  importPetPackage,
  listImportedPetPackages,
  localPetPackageManagementAvailable,
  removeImportedPetPackage,
} from "./runtime/pet-package-store";
import {
  configureIpc,
  quitApplication,
  reconnectIpc,
  resizeWindowForScale,
  setAlwaysOnTop,
  startWindowDrag,
  subscribeToRuntime,
  type ConnectionStatus,
  type RuntimeSnapshot,
} from "./runtime/tauri-bridge";
import { BubbleController } from "./ui/bubble-controller";
import {
  PetInteractionController,
  type PetInteractionToken,
} from "./ui/pet-interaction-controller";
import { isPetClickGesture } from "./ui/pet-click-gesture";
import {
  resolvePetInteractionDurationMs,
  resolvePetInteractionPresentation,
} from "./ui/pet-interaction-presentation";
import { PetRenderer } from "./ui/pet-renderer";
import { ReducedMotionPreference } from "./ui/reduced-motion-preference";
import { StateVariantScheduler } from "./ui/state-variant-scheduler";
import { TimedPetInteraction } from "./ui/timed-pet-interaction";

const SUCCESS_ANIMATION_DURATION_MS = 8_000;
const CLICK_INTERACTION_DURATION_MS = 650;
const CLICK_GESTURE_MAX_DURATION_MS = 300;

const app = requiredElement<HTMLElement>("#app");
const petImage = requiredElement<HTMLImageElement>("#pet-image");
const petDragHandle = requiredElement<HTMLButtonElement>("#pet-drag-handle");
const stateLabel = requiredElement<HTMLElement>("#state-label");
const connectionLabel = requiredElement<HTMLElement>("#connection-label");
const connectionBadge = requiredElement<HTMLElement>("#connection-badge");
const connectionErrorLabel = requiredElement<HTMLElement>("#connection-error-label");
const settingsPanel = requiredElement<HTMLElement>("#settings-panel");
const settingsDragHandle = requiredElement<HTMLElement>("#settings-drag-handle");
const settingsToggle = requiredElement<HTMLButtonElement>("#settings-toggle");
const onboardingPanel = requiredElement<HTMLElement>("#onboarding-panel");
const onboardingStatus = requiredElement<HTMLElement>("#onboarding-status");
const onboardingConnectionLabel = requiredElement<HTMLElement>("#onboarding-connection-label");
const agentConnectionPrompt = requiredElement<HTMLElement>("#agent-connection-prompt");
const copyAgentPromptStatus = requiredElement<HTMLElement>("#copy-agent-prompt-status");
const petPackageInput = requiredElement<HTMLSelectElement>("#pet-package-input");
const petPackageError = requiredElement<HTMLElement>("#pet-package-error");
const petPackageStatus = requiredElement<HTMLElement>("#pet-package-status");
const importPetPackageButton = requiredElement<HTMLButtonElement>("#import-pet-package-button");
const removePetPackageButton = requiredElement<HTMLButtonElement>("#remove-pet-package-button");
const stateAnimationGrid = requiredElement<HTMLElement>("#state-animation-grid");
const settingsActionError = requiredElement<HTMLElement>("#settings-action-error");
const fatalError = requiredElement<HTMLElement>("#fatal-error");

const bubble = new BubbleController(
  requiredElement<HTMLElement>("#state-bubble"),
  requiredElement<HTMLElement>("#bubble-eyebrow"),
  requiredElement<HTMLElement>("#bubble-message"),
  requiredElement<HTMLElement>("#bubble-file"),
  requiredElement<HTMLButtonElement>("#bubble-close"),
  acknowledgeError,
);

const settingsRepository = new SettingsRepository();
const stateVariantScheduler = new StateVariantScheduler({
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
});
const petInteractionController = new PetInteractionController(renderPetInteraction);
const timedPetInteraction = new TimedPetInteraction(petInteractionController, {
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (timerId) => window.clearTimeout(timerId),
});
let settings = { ...DEFAULT_SETTINGS };
let petCatalog: PetPackageCatalog;
let petPackage: LoadedPetPackage;
let currentEvent: AgentStateEvent = { type: "state", state: "idle" };
let hasRenderedState = false;
let petRenderer: PetRenderer;
let stateRevision = 0;
let successTimer: number | null = null;
let unsubscribeRuntime: (() => void) | null = null;
let connectionRevision = -1;
let settingsPersistenceRevision = 0;
let settingsWriteQueue: Promise<void> = Promise.resolve();
let hoverInteractionToken: PetInteractionToken | null = null;
let petPointerDownAtMs: number | null = null;
let disposeReducedMotionPreference: (() => void) | null = null;
let reducedMotionPreference: ReducedMotionPreference;

void bootstrap();

async function bootstrap(): Promise<void> {
  try {
    settings = await settingsRepository.load();
    petCatalog = await loadPetPackageCatalog();
    try {
      petCatalog.packages.push(...(await listImportedPetPackages()));
    } catch (error) {
      petCatalog.warnings.push({
        packageId: "local-imports",
        message: describeError(error),
      });
    }
    petPackage = selectAvailablePetPackage(settings.petPackageId);
    if (settings.petPackageId !== petPackage.catalogId) {
      settings.petPackageId = petPackage.catalogId;
      settings.stateAnimationOverrides = {};
      settings = await persistSettings(settings);
    }
    petRenderer = new PetRenderer(
      petImage,
      petPackage,
      new URL("pets/fallback-idle.svg", document.baseURI).href,
    );
    reducedMotionPreference = new ReducedMotionPreference((enabled) => {
      document.documentElement.dataset.reducedMotion = String(enabled);
      petRenderer.setReducedMotion(enabled);
    });
    disposeReducedMotionPreference = bindReducedMotionPreference(reducedMotionPreference);
    bindSettingsControls();
    populatePetPackageControls();
    populateStateAnimationControls();
    applySettingsPresentation(settings);
    await applyNativeSettings(settings).catch((error) => reportSettingsError(error));
    renderState(currentEvent, false);

    if (settings.onboardingVersion < CURRENT_ONBOARDING_VERSION) {
      setOnboardingOpen(true);
    }

    unsubscribeRuntime = await subscribeToRuntime({
      onState: receiveState,
      onConnection: renderConnection,
      onOpenSettings: () => setSettingsOpen(true),
      onAlwaysOnTopChanged: (alwaysOnTop) =>
        runSettingsOperation(receiveAlwaysOnTopChanged(alwaysOnTop), "无法保存置顶设置"),
    });
    await configureIpc("", true);
  } catch (error) {
    showFatalError(error);
  }
}

function receiveState(payload: unknown): void {
  const event = parseAgentStateEvent(payload);
  if (!event) {
    return;
  }

  renderState(event, true);
}

function acknowledgeError(): void {
  if (currentEvent.state === "error") {
    renderState({ type: "state", state: "idle" }, false);
  }
}

function renderState(event: AgentStateEvent, showBubble: boolean): void {
  const stateChanged = !hasRenderedState || currentEvent.state !== event.state;
  if (stateChanged) {
    stateRevision += 1;
  }
  currentEvent = event;
  hasRenderedState = true;
  const presentation = STATE_PRESENTATION[event.state];

  stateLabel.textContent = `${presentation.shortLabel} · ${presentation.label}`;
  petDragHandle.setAttribute("aria-label", `${presentation.label}，拖动桌宠`);
  if (stateChanged) {
    app.dataset.state = event.state;
    refreshPetPresentation();
  }

  if (showBubble) {
    bubble.show(event, settings);
  }

  if (stateChanged) {
    if (successTimer !== null) {
      window.clearTimeout(successTimer);
      successTimer = null;
    }

    if (event.state === "success") {
      const revisionAtSuccess = stateRevision;
      successTimer = window.setTimeout(() => {
        if (stateRevision === revisionAtSuccess && currentEvent.state === "success") {
          renderState({ type: "state", state: "idle" }, false);
        }
      }, SUCCESS_ANIMATION_DURATION_MS);
    }
  }
}

function renderStateAnimation(state: AgentStateEvent["state"]): void {
  const configuredOverride = settings.stateAnimationOverrides[state];
  const validConfiguredOverride =
    configuredOverride && petPackage.manifest.animations[configuredOverride]
      ? configuredOverride
      : undefined;
  petRenderer.render(state, validConfiguredOverride);
}

function renderPetInteraction(_interactionId: string | null): void {
  refreshPetPresentation();
}

function refreshPetPresentation(): void {
  const interactionId = petInteractionController.currentInteractionId;
  const interaction = resolvePetInteractionPresentation(petPackage, interactionId);
  if (interaction.interactionId) {
    app.dataset.action = interaction.interactionId;
  } else {
    delete app.dataset.action;
  }
  if (interaction.fallbackEffectId) {
    app.dataset.actionFallback = interaction.fallbackEffectId;
  } else {
    delete app.dataset.actionFallback;
  }
  if (interaction.animationId) {
    petRenderer.renderAnimation(interaction.animationId);
  } else {
    renderStateAnimation(currentEvent.state);
  }

  if (interactionId) {
    stateVariantScheduler.clear();
  } else {
    scheduleStateVariants(currentEvent.state, stateRevision);
  }
}

function scheduleStateVariants(state: AgentStateEvent["state"], revision: number): void {
  stateVariantScheduler.schedule({
    variants: petPackage.manifest.stateVariants[state] ?? [],
    disabled: Boolean(validStateAnimationOverride(state)),
    isCurrent: () =>
      stateRevision === revision &&
      currentEvent.state === state &&
      petInteractionController.currentInteractionId === null,
    activate: (animationId) => petRenderer.renderAnimation(animationId),
  });
}

function renderConnection(snapshot: RuntimeSnapshot): void {
  if (snapshot.revision < connectionRevision) {
    return;
  }
  connectionRevision = snapshot.revision;
  const labels: Record<ConnectionStatus, string> = {
    connecting: "正在连接",
    connected: "已连接",
    disconnected: "未连接",
    disabled: "已停用",
  };

  app.dataset.connection = snapshot.status;
  connectionLabel.textContent = labels[snapshot.status];
  connectionBadge.textContent = snapshot.status === "connected" ? "MCP 在线" : labels[snapshot.status];
  connectionBadge.hidden = snapshot.status === "connected";
  connectionErrorLabel.textContent = snapshot.lastError ? `连接详情：${snapshot.lastError}` : "";
  connectionErrorLabel.hidden = !snapshot.lastError;

  onboardingStatus.dataset.connection = snapshot.status;
  onboardingConnectionLabel.textContent = labels[snapshot.status];
}

function bindSettingsControls(): void {
  const settingsForm = requiredElement<HTMLFormElement>("#settings-form");
  const scaleInput = requiredElement<HTMLInputElement>("#scale-input");
  const opacityInput = requiredElement<HTMLInputElement>("#opacity-input");
  const durationInput = requiredElement<HTMLInputElement>("#duration-input");
  const alwaysOnTopInput = requiredElement<HTMLInputElement>("#always-on-top-input");
  const bubbleInput = requiredElement<HTMLInputElement>("#bubble-input");
  const fileInput = requiredElement<HTMLInputElement>("#file-input");

  settingsForm.addEventListener("submit", (event) => event.preventDefault());
  agentConnectionPrompt.textContent = AGENT_CONNECTION_PROMPT;

  settingsToggle.addEventListener("click", () => setSettingsOpen(settingsPanel.hidden));
  requiredElement<HTMLButtonElement>("#settings-close").addEventListener("click", () =>
    setSettingsOpen(false),
  );
  settingsDragHandle.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !(event.target instanceof Element && event.target.closest("button"))) {
      runSettingsOperation(startWindowDrag(), "无法拖动设置窗口");
    }
  });

  scaleInput.addEventListener("input", () => {
    settings.scale = Number(scaleInput.value) / 100;
    runSettingsOperation(persistAndApplySettings());
  });
  opacityInput.addEventListener("input", () => {
    settings.opacity = Number(opacityInput.value) / 100;
    runSettingsOperation(persistAndApplySettings());
  });
  durationInput.addEventListener("input", () => {
    settings.successBubbleDurationMs = Number(durationInput.value) * 1_000;
    runSettingsOperation(persistAndApplySettings());
  });
  alwaysOnTopInput.addEventListener("change", () => {
    settings.alwaysOnTop = alwaysOnTopInput.checked;
    runSettingsOperation(persistAndApplySettings());
  });
  bubbleInput.addEventListener("change", () => {
    settings.showStateBubble = bubbleInput.checked;
    if (!settings.showStateBubble) {
      bubble.hide();
    }
    runSettingsOperation(persistAndApplySettings());
  });
  fileInput.addEventListener("change", () => {
    settings.showFilePath = fileInput.checked;
    bubble.setFileVisibility(settings.showFilePath, currentEvent.file);
    runSettingsOperation(persistAndApplySettings());
  });
  petPackageInput.addEventListener("change", () => {
    void changePetPackage(petPackageInput.value);
  });
  importPetPackageButton.disabled = !localPetPackageManagementAvailable();
  importPetPackageButton.title = importPetPackageButton.disabled
    ? "请在桌面应用中导入本地资源包"
    : "选择并安全导入 pet.json";
  importPetPackageButton.addEventListener("click", () => {
    void importLocalPetPackage();
  });
  removePetPackageButton.addEventListener("click", () => {
    void removeCurrentPetPackage();
  });

  requiredElement<HTMLButtonElement>("#reconnect-button").addEventListener("click", () => {
    runSettingsOperation(reconnectIpc(), "无法重新连接");
  });
  requiredElement<HTMLButtonElement>("#reset-button").addEventListener("click", () => {
    runSettingsOperation(resetSettings(), "无法恢复默认设置");
  });
  requiredElement<HTMLButtonElement>("#onboarding-button").addEventListener("click", () => {
    setOnboardingOpen(true);
  });
  requiredElement<HTMLButtonElement>("#quit-button").addEventListener("click", () => {
    void requestApplicationExit();
  });
  requiredElement<HTMLButtonElement>("#onboarding-close").addEventListener("click", () => {
    runSettingsOperation(completeOnboarding(false), "无法关闭接入向导");
  });
  requiredElement<HTMLButtonElement>("#onboarding-done").addEventListener("click", () => {
    runSettingsOperation(completeOnboarding(true), "无法保存接入向导状态");
  });
  requiredElement<HTMLButtonElement>("#onboarding-reconnect").addEventListener("click", () => {
    runSettingsOperation(reconnectIpc(), "无法重新检测连接");
  });
  requiredElement<HTMLButtonElement>("#copy-agent-prompt").addEventListener("click", () => {
    void copyAgentConnectionPrompt();
  });

  petDragHandle.addEventListener("pointerdown", (event) => {
    if (event.button === 0) {
      petPointerDownAtMs = performance.now();
      runSettingsOperation(dragPet(), "无法拖动桌宠");
    }
  });
  petDragHandle.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") {
      beginPetHover();
      bubble.showDetails(currentEvent, settings);
    }
  });
  petDragHandle.addEventListener("pointerleave", endPetHover);
  petDragHandle.addEventListener("click", (event) => {
    const pointerDownAtMs = petPointerDownAtMs;
    petPointerDownAtMs = null;
    if (
      isPetClickGesture(
        event.detail,
        pointerDownAtMs,
        performance.now(),
        CLICK_GESTURE_MAX_DURATION_MS,
      )
    ) {
      timedPetInteraction.trigger(
        "clicked",
        resolvePetInteractionDurationMs(
          petPackage,
          "clicked",
          CLICK_INTERACTION_DURATION_MS,
        ),
      );
    }
  });
  petDragHandle.addEventListener("focus", () => bubble.showDetails(currentEvent, settings));
  petDragHandle.addEventListener("dblclick", () => bubble.showDetails(currentEvent, settings));

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") {
      return;
    }
    if (!onboardingPanel.hidden) {
      setOnboardingOpen(false);
    } else if (!settingsPanel.hidden) {
      setSettingsOpen(false);
    }
  });

  window.addEventListener("beforeunload", () => {
    bubble.dispose();
    timedPetInteraction.dispose();
    disposeReducedMotionPreference?.();
    unsubscribeRuntime?.();
  });
}

function bindReducedMotionPreference(preferenceController: ReducedMotionPreference): () => void {
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  const applyPreference = (matches: boolean): void => {
    preferenceController.setSystemRequested(matches);
  };
  const handleChange = (event: MediaQueryListEvent): void => applyPreference(event.matches);
  applyPreference(preference.matches);
  preference.addEventListener("change", handleChange);
  return () => preference.removeEventListener("change", handleChange);
}

function beginPetHover(): void {
  if (hoverInteractionToken === null) {
    hoverInteractionToken = petInteractionController.begin("hovering");
  }
}

function endPetHover(): void {
  const interactionToken = hoverInteractionToken;
  hoverInteractionToken = null;
  if (interactionToken !== null) {
    petInteractionController.end(interactionToken);
  }
}

async function dragPet(): Promise<void> {
  const interactionToken = petInteractionController.begin("dragging");
  try {
    await startWindowDrag();
  } finally {
    petInteractionController.end(interactionToken);
  }
}

async function requestApplicationExit(): Promise<void> {
  settingsActionError.hidden = true;
  settingsActionError.textContent = "";
  try {
    await quitApplication();
  } catch (error) {
    settingsActionError.textContent = `无法退出应用：${describeError(error)}`;
    settingsActionError.hidden = false;
  }
}

async function copyAgentConnectionPrompt(): Promise<void> {
  try {
    await navigator.clipboard.writeText(AGENT_CONNECTION_PROMPT);
    copyAgentPromptStatus.textContent = "已复制。现在粘贴给 Agent，并按 Agent 的提示完成连接。";
  } catch (error) {
    copyAgentPromptStatus.textContent = `复制失败：${describeError(error)}。请手动选择上方提示词复制。`;
  }
}

function populatePetPackageControls(): void {
  petPackageInput.replaceChildren(
    ...petCatalog.packages.map(({ catalogId, manifest, source }) => {
      const sourceLabel = source === "imported" ? "本地 · " : "";
      const option = new Option(
        `${sourceLabel}${manifest.name} · v${manifest.version}`,
        catalogId,
      );
      option.title = `${manifest.author} · ${manifest.license}`;
      return option;
    }),
  );
  petPackageInput.value = petPackage.catalogId;
  removePetPackageButton.disabled = petPackage.source !== "imported";
  removePetPackageButton.title =
    petPackage.source === "imported" ? "删除当前本地资源包" : "内置资源包不能删除";
  if (petCatalog.warnings.length > 0) {
    petPackageError.textContent = `已跳过 ${petCatalog.warnings.length} 个无效资源包：${petCatalog.warnings
      .map(({ packageId }) => packageId)
      .join("、")}`;
    petPackageError.hidden = false;
  }
}

function populateStateAnimationControls(): void {
  const animationEntries = Object.entries(petPackage.manifest.animations);
  stateAnimationGrid.replaceChildren(
    ...AGENT_STATES.map((state) => {
      const label = document.createElement("label");
      const labelText = document.createElement("span");
      const select = document.createElement("select");
      const defaultAnimation = petPackage.manifest.states[state];

      labelText.textContent = STATE_PRESENTATION[state].label;
      select.dataset.state = state;
      select.setAttribute("aria-label", `${STATE_PRESENTATION[state].label}动作`);
      select.append(new Option(`跟随资源包 · ${defaultAnimation}`, ""));
      for (const [animationId, animation] of animationEntries) {
        select.append(new Option(`${animationId} · ${animation.alt}`, animationId));
      }
      select.value = validStateAnimationOverride(state) ?? "";
      select.addEventListener("change", () => {
        const nextOverrides = { ...settings.stateAnimationOverrides };
        if (select.value) {
          nextOverrides[state] = select.value;
        } else {
          delete nextOverrides[state];
        }
        settings.stateAnimationOverrides = nextOverrides;
        if (state === currentEvent.state) {
          refreshPetPresentation();
        }
        runSettingsOperation(persistSettings(settings));
      });

      label.append(labelText, select);
      return label;
    }),
  );
}

async function changePetPackage(packageId: string): Promise<void> {
  petPackageInput.disabled = true;
  petPackageError.hidden = true;
  try {
    const nextPackage = selectPetPackage(petCatalog, packageId);
    petPackage = nextPackage;
    petRenderer.setPackage(nextPackage);
    settings.petPackageId = nextPackage.catalogId;
    settings.stateAnimationOverrides = {};
    applyPetPackagePresentation();
    populateStateAnimationControls();
    refreshPetPresentation();
    await persistSettings(settings);
    populatePetPackageControls();
  } catch (error) {
    petPackageError.textContent = `无法切换资源包：${describeError(error)}`;
    petPackageError.hidden = false;
  } finally {
    petPackageInput.value = petPackage.catalogId;
    petPackageInput.disabled = false;
  }
}

async function importLocalPetPackage(): Promise<void> {
  setPetPackageBusy(true);
  petPackageError.hidden = true;
  setPetPackageStatus("正在验证并复制资源包…");
  try {
    const importedPackage = await importPetPackage();
    if (!importedPackage) {
      setPetPackageStatus("已取消导入。");
      return;
    }

    const existingIndex = petCatalog.packages.findIndex(
      ({ catalogId }) => catalogId === importedPackage.catalogId,
    );
    if (existingIndex >= 0) {
      petCatalog.packages[existingIndex] = importedPackage;
    } else {
      petCatalog.packages.push(importedPackage);
    }
    populatePetPackageControls();
    await changePetPackage(importedPackage.catalogId);
    setPetPackageStatus(
      `已导入“${importedPackage.manifest.name}”，原始目录现在可以移动或删除。`,
    );
  } catch (error) {
    petPackageError.textContent = `无法导入资源包：${describeError(error)}`;
    petPackageError.hidden = false;
    setPetPackageStatus("", true);
  } finally {
    setPetPackageBusy(false);
  }
}

async function removeCurrentPetPackage(): Promise<void> {
  if (petPackage.source !== "imported") {
    return;
  }

  const packageToRemove = petPackage;
  setPetPackageBusy(true);
  petPackageError.hidden = true;
  setPetPackageStatus(`正在删除“${packageToRemove.manifest.name}”…`);
  try {
    const fallbackPackage = selectPetPackage(petCatalog);
    await changePetPackage(fallbackPackage.catalogId);
    setPetPackageBusy(true);
    await removeImportedPetPackage(packageToRemove.catalogId);
    petCatalog.packages = petCatalog.packages.filter(
      ({ catalogId }) => catalogId !== packageToRemove.catalogId,
    );
    populatePetPackageControls();
    setPetPackageStatus(`已删除“${packageToRemove.manifest.name}”。`);
  } catch (error) {
    petPackageError.textContent = `无法删除资源包：${describeError(error)}`;
    petPackageError.hidden = false;
    setPetPackageStatus("", true);
  } finally {
    setPetPackageBusy(false);
  }
}

function setPetPackageBusy(busy: boolean): void {
  petPackageInput.disabled = busy;
  importPetPackageButton.disabled = busy || !localPetPackageManagementAvailable();
  removePetPackageButton.disabled = busy || petPackage.source !== "imported";
}

function setPetPackageStatus(message: string, hide = false): void {
  petPackageStatus.textContent = message;
  petPackageStatus.hidden = hide || message === "";
}

function selectAvailablePetPackage(packageId: string): LoadedPetPackage {
  try {
    return selectPetPackage(petCatalog, packageId);
  } catch {
    return selectPetPackage(petCatalog);
  }
}

function validStateAnimationOverride(state: AgentState): string | undefined {
  const animationId = settings.stateAnimationOverrides[state];
  return animationId && petPackage.manifest.animations[animationId] ? animationId : undefined;
}

function applyPetPackagePresentation(): void {
  const { fit, anchor } = petPackage.manifest.canvas;
  petImage.style.objectFit = fit;
  petImage.style.objectPosition = `${Math.round(anchor.x * 100)}% ${Math.round(anchor.y * 100)}%`;
  petImage.style.transformOrigin = `${Math.round(anchor.x * 100)}% ${Math.round(anchor.y * 100)}%`;
}

async function completeOnboarding(reconnect: boolean): Promise<void> {
  if (reconnect) {
    settings.onboardingVersion = CURRENT_ONBOARDING_VERSION;
    await persistSettings(settings);
    await reconnectIpc();
  }
  setOnboardingOpen(false);
}

async function receiveAlwaysOnTopChanged(alwaysOnTop: boolean): Promise<void> {
  settings.alwaysOnTop = alwaysOnTop;
  requiredElement<HTMLInputElement>("#always-on-top-input").checked = alwaysOnTop;
  // Re-apply at the tail of the frontend settings queue. A snapshot queued
  // before the tray click may still contain the old value; this guarantees
  // both Store and native window converge on the explicit tray action.
  await persistSettings(settings, true);
}

async function persistAndApplySettings(): Promise<void> {
  settings = normalizeSettings(settings);
  applySettingsPresentation(settings);
  await persistSettings(settings, true);
}

async function resetSettings(): Promise<void> {
  const onboardingVersion = settings.onboardingVersion;
  const revision = ++settingsPersistenceRevision;
  settings = await enqueueSettingsWrite(() => settingsRepository.reset(onboardingVersion));
  if (revision !== settingsPersistenceRevision) {
    return;
  }
  petPackage = selectAvailablePetPackage(settings.petPackageId);
  settings.petPackageId = petPackage.catalogId;
  petRenderer.setPackage(petPackage);
  populatePetPackageControls();
  populateStateAnimationControls();
  applyPetPackagePresentation();
  applySettingsPresentation(settings);
  await applyNativeSettings(settings);
  refreshPetPresentation();
  await configureIpc("", true);
}

function applySettingsPresentation(nextSettings: AppSettings): void {
  const scalePercent = Math.round(nextSettings.scale * 100);
  const opacityPercent = Math.round(nextSettings.opacity * 100);
  const durationSeconds = Math.round(nextSettings.successBubbleDurationMs / 1_000);

  app.style.setProperty("--pet-scale", String(nextSettings.scale));
  app.style.setProperty(
    "--pet-column-width",
    `${Math.round(360 + Math.max(0, 286 * nextSettings.scale - 286))}px`,
  );
  app.style.setProperty("--pet-width", `${Math.round(286 * nextSettings.scale)}px`);
  app.style.setProperty("--pet-height", `${Math.round(272 * nextSettings.scale)}px`);
  app.style.setProperty("--pet-opacity", String(nextSettings.opacity));
  requiredElement<HTMLInputElement>("#scale-input").value = String(scalePercent);
  requiredElement<HTMLInputElement>("#opacity-input").value = String(opacityPercent);
  requiredElement<HTMLInputElement>("#duration-input").value = String(durationSeconds);
  requiredElement<HTMLOutputElement>("#scale-output").value = `${scalePercent}%`;
  requiredElement<HTMLOutputElement>("#opacity-output").value = `${opacityPercent}%`;
  requiredElement<HTMLOutputElement>("#duration-output").value = `${durationSeconds} 秒`;
  requiredElement<HTMLInputElement>("#always-on-top-input").checked = nextSettings.alwaysOnTop;
  requiredElement<HTMLInputElement>("#bubble-input").checked = nextSettings.showStateBubble;
  requiredElement<HTMLInputElement>("#file-input").checked = nextSettings.showFilePath;
  petPackageInput.value = petPackage.catalogId;
  for (const select of stateAnimationGrid.querySelectorAll<HTMLSelectElement>("select[data-state]")) {
    const state = select.dataset.state as AgentState;
    select.value = validStateAnimationOverride(state) ?? "";
  }
  applyPetPackagePresentation();
}

async function applyNativeSettings(nextSettings: AppSettings): Promise<void> {
  await setAlwaysOnTop(nextSettings.alwaysOnTop);
  await resizeWindowForScale(nextSettings.scale, sidePanelOpen());
}

async function persistSettings(
  nextSettings: AppSettings,
  applyNative = false,
): Promise<AppSettings> {
  const desired = normalizeSettings(nextSettings);
  const revision = ++settingsPersistenceRevision;
  const persisted = await enqueueSettingsWrite(async () => {
    const saved = await settingsRepository.save(desired);
    if (applyNative) {
      await applyNativeSettings(saved);
    }
    return saved;
  });
  if (revision === settingsPersistenceRevision) {
    settings = persisted;
  }
  return persisted;
}

function enqueueSettingsWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = settingsWriteQueue.then(operation);
  settingsWriteQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function runSettingsOperation(operation: Promise<unknown>, failurePrefix = "无法应用设置"): void {
  settingsActionError.hidden = true;
  settingsActionError.textContent = "";
  void operation.catch((error) => reportSettingsError(error, failurePrefix));
}

function reportSettingsError(error: unknown, failurePrefix = "无法应用设置"): void {
  settingsActionError.textContent = `${failurePrefix}：${describeError(error)}`;
  settingsActionError.hidden = false;
}

function setSettingsOpen(open: boolean): void {
  if (open) {
    onboardingPanel.hidden = true;
  }
  settingsPanel.hidden = !open;
  settingsToggle.setAttribute("aria-expanded", String(open));
  settingsToggle.hidden = open || !onboardingPanel.hidden;
  syncWindowLayout();
  if (open) {
    requiredElement<HTMLInputElement>("#scale-input").focus();
  }
}

function setOnboardingOpen(open: boolean): void {
  if (open) {
    settingsPanel.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
  }
  onboardingPanel.hidden = !open;
  settingsToggle.hidden = open;
  syncWindowLayout();
  if (open) {
    requiredElement<HTMLButtonElement>("#copy-agent-prompt").focus();
  }
}

function sidePanelOpen(): boolean {
  return !settingsPanel.hidden || !onboardingPanel.hidden;
}

function syncWindowLayout(): void {
  runSettingsOperation(
    resizeWindowForScale(settings.scale, sidePanelOpen()),
    "无法调整侧栏窗口",
  );
}

function showFatalError(error: unknown): void {
  const message = describeError(error, "应用初始化失败");
  fatalError.textContent = `无法启动桌宠：${message}`;
  fatalError.hidden = false;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }
  return element;
}
