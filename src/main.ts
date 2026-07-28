import {
  AGENT_STATES,
  parseAgentStateEvent,
  STATE_PRESENTATION,
  type AgentState,
  type AgentStateEvent,
} from "./domain/agent-state";
import {
  loadPetPackageCatalog,
  resolvePetAnimation,
  selectPetPackage,
  type LoadedPetPackage,
  type PetPackageCatalog,
} from "./domain/pet-package";
import { petPackageOptionLabel } from "./domain/pet-package-option-label";
import {
  CURRENT_ONBOARDING_VERSION,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from "./domain/settings";
import { describeError } from "./domain/error-message";
import {
  AGENT_CONNECTION_PROMPT,
  CODEX_MCP_COMMAND,
  MCP_CONFIG_JSON,
  MCP_RUN_COMMAND,
  NODE_NPM_CHECK_COMMAND,
  NPM_CACHE_VERIFY_COMMAND,
} from "./domain/agent-connection-prompt";
import { SettingsRepository } from "./runtime/settings-store";
import {
  importPetPackage,
  listImportedPetPackages,
  localPetPackageManagementAvailable,
  removeImportedPetPackage,
} from "./runtime/pet-package-store";
import {
  configureIpc,
  openProjectIntro,
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
import { showCopyButtonFeedback } from "./ui/copy-button-feedback";
import { loadActionPreviewPoster } from "./ui/action-preview-poster";
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
import { shouldDismissSettingsFromTarget } from "./ui/settings-dismiss";
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
const copyAgentPromptStatus = requiredElement<HTMLElement>("#copy-agent-prompt-status");
const petPackageInput = requiredElement<HTMLSelectElement>("#pet-package-input");
const petPackageError = requiredElement<HTMLElement>("#pet-package-error");
const petPackageStatus = requiredElement<HTMLElement>("#pet-package-status");
const importPetPackageButton = requiredElement<HTMLButtonElement>("#import-pet-package-button");
const removePetPackageButton = requiredElement<HTMLButtonElement>("#remove-pet-package-button");
const stateAnimationOverview = requiredElement<HTMLElement>("#state-animation-overview");
const stateAnimationGrid = requiredElement<HTMLElement>("#state-animation-grid");
const actionPreviewStaging = requiredElement<HTMLElement>("#action-preview-staging");
const actionPreviewImage = requiredElement<HTMLImageElement>("#action-preview-image");
const settingsActionError = requiredElement<HTMLElement>("#settings-action-error");
const fatalError = requiredElement<HTMLElement>("#fatal-error");

const bubble = new BubbleController(
  requiredElement<HTMLElement>("#state-bubble"),
  requiredElement<HTMLElement>("#bubble-session-title"),
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
let latestAgentEvent: AgentStateEvent = currentEvent;
let hasRenderedState = false;
let petRenderer: PetRenderer;
let actionPreviewRenderer: PetRenderer;
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
    const fallbackPetUrl = new URL("pets/fallback-idle.svg", document.baseURI).href;
    petRenderer = new PetRenderer(petImage, petPackage, fallbackPetUrl);
    actionPreviewRenderer = new PetRenderer(actionPreviewImage, petPackage, fallbackPetUrl);
    reducedMotionPreference = new ReducedMotionPreference((enabled) => {
      document.documentElement.dataset.reducedMotion = String(enabled);
      petRenderer.setReducedMotion(enabled);
      actionPreviewRenderer.setReducedMotion(enabled);
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

  latestAgentEvent = event;
  renderState(event, true);
}

function acknowledgeError(): void {
  if (currentEvent.state === "error") {
    const idleEvent: AgentStateEvent = { type: "state", state: "idle" };
    latestAgentEvent = idleEvent;
    renderState(idleEvent, false);
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
  petRenderer.render(state, validStateAnimationOverride(state));
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
  const alwaysOnTopInput = requiredElement<HTMLInputElement>("#always-on-top-input");
  const launchAtStartupInput = requiredElement<HTMLInputElement>("#launch-at-startup-input");
  const bubbleInput = requiredElement<HTMLInputElement>("#bubble-input");

  settingsForm.addEventListener("submit", (event) => event.preventDefault());
  populateOnboardingContent();

  settingsToggle.addEventListener("click", (event) => {
    // The toggle lives outside the panel. Prevent the same opening click from
    // bubbling into the outside-click closer and immediately undoing itself.
    event.stopPropagation();
    setSettingsOpen(settingsPanel.hidden);
  });
  requiredElement<HTMLButtonElement>("#settings-close").addEventListener("click", () =>
    setSettingsOpen(false),
  );
  app.addEventListener("click", closeSettingsFromOutside);
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
  alwaysOnTopInput.addEventListener("change", () => {
    settings.alwaysOnTop = alwaysOnTopInput.checked;
    runSettingsOperation(persistAndApplySettings());
  });
  launchAtStartupInput.addEventListener("change", () => {
    runSettingsOperation(
      updateLaunchAtStartup(launchAtStartupInput.checked),
      "无法更改开机自启",
    );
  });
  bubbleInput.addEventListener("change", () => {
    settings.showStateBubble = bubbleInput.checked;
    if (!settings.showStateBubble) {
      bubble.hide();
    }
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
  requiredElement<HTMLButtonElement>("#project-intro-button").addEventListener("click", () => {
    runSettingsOperation(openProjectIntro(), "无法打开项目介绍");
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
  const copyAgentPromptButton = requiredElement<HTMLButtonElement>("#copy-agent-prompt");
  copyAgentPromptButton.addEventListener("click", () => {
    void copyOnboardingText(AGENT_CONNECTION_PROMPT, "完整指令", copyAgentPromptButton);
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-target]")) {
    button.addEventListener("click", () => {
      const targetId = button.dataset.copyTarget;
      const target = targetId ? document.getElementById(targetId) : null;
      if (target?.textContent) {
        void copyOnboardingText(
          target.textContent,
          button.dataset.copyLabel ?? "内容",
          button,
        );
      }
    });
  }

  petDragHandle.addEventListener("pointerdown", (event) => {
    if (event.button === 0) {
      petPointerDownAtMs = performance.now();
      runSettingsOperation(dragPet(), "无法拖动桌宠");
    }
  });
  petDragHandle.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") {
      beginPetHover();
      bubble.showDetails(latestAgentEvent, settings);
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

function populateOnboardingContent(): void {
  requiredElement<HTMLElement>("#codex-mcp-command").textContent = CODEX_MCP_COMMAND;
  requiredElement<HTMLElement>("#agent-mcp-config").textContent = MCP_CONFIG_JSON;
  requiredElement<HTMLElement>("#manual-mcp-config").textContent = MCP_CONFIG_JSON;
  requiredElement<HTMLElement>("#node-npm-check-command").textContent = NODE_NPM_CHECK_COMMAND;
  requiredElement<HTMLElement>("#mcp-run-command").textContent = MCP_RUN_COMMAND;
  requiredElement<HTMLElement>("#npm-cache-command").textContent = NPM_CACHE_VERIFY_COMMAND;
}

async function copyOnboardingText(
  value: string,
  label: string,
  button: HTMLButtonElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    copyAgentPromptStatus.textContent = `已复制${label}。`;
    showCopyButtonFeedback(button, "success");
  } catch (error) {
    copyAgentPromptStatus.textContent = `复制失败：${describeError(error)}。请手动选择对应内容复制。`;
    showCopyButtonFeedback(button, "error");
  }
}

function populatePetPackageControls(): void {
  petPackageInput.replaceChildren(
    ...petCatalog.packages.map(({ catalogId, manifest, source }) => {
      const option = new Option(
        petPackageOptionLabel(manifest.name, manifest.version, source),
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

function populateStateAnimationControls(previewState: AgentState = currentEvent.state): void {
  collapseStateAnimationChoices();
  stateAnimationGrid.replaceChildren(
    ...AGENT_STATES.map((state) => {
      const item = document.createElement("div");
      const choiceGrid = document.createElement("div");
      const animationOverride = validStateAnimationOverride(state) ?? "";
      const resolved = resolvePetAnimation(petPackage, state, animationOverride || undefined);
      const card = createActionCard({
        className: "state-action-card",
        state,
        animationOverride,
        title: STATE_PRESENTATION[state].label,
        subtitle: resolved.id,
        ariaLabel: `选择${STATE_PRESENTATION[state].label}状态动作，当前为${resolved.id}`,
        onActivate: () => toggleAnimationChoices(item, state, choiceGrid),
      });
      item.className = "state-action-item";
      item.dataset.state = state;
      item.dataset.expanded = "false";
      choiceGrid.id = `animation-choices-${state}`;
      choiceGrid.className = "animation-choice-grid";
      choiceGrid.hidden = true;
      card.setAttribute("aria-expanded", "false");
      card.setAttribute("aria-controls", choiceGrid.id);
      item.append(card, choiceGrid);
      return item;
    }),
  );
  const currentStateCard = stateAnimationGrid.querySelector<HTMLElement>(
    `[data-state="${previewState}"]`,
  );
  if (currentStateCard) {
    mountActionPreview(
      currentStateCard.querySelector<HTMLElement>(".action-preview-slot")!,
      previewState,
      validStateAnimationOverride(previewState) ?? "",
    );
  }
}

function createActionCard({
  className,
  state,
  animationOverride,
  title,
  subtitle,
  ariaLabel,
  onActivate,
}: {
  className: string;
  state: AgentState;
  animationOverride: string;
  title: string;
  subtitle?: string;
  ariaLabel: string;
  onActivate: () => void;
}): HTMLButtonElement {
  const card = document.createElement("button");
  const previewSlot = document.createElement("span");
  const placeholder = document.createElement("img");
  const copy = document.createElement("span");
  const heading = document.createElement("strong");

  card.type = "button";
  card.className = className;
  card.dataset.state = state;
  card.dataset.animation = animationOverride || petPackage.manifest.states[state];
  card.dataset.animationOverride = animationOverride;
  card.setAttribute("aria-label", ariaLabel);
  previewSlot.className = "action-preview-slot";
  placeholder.className = "action-preview-placeholder";
  const fallback = new URL("pets/fallback-idle.svg", document.baseURI).href;
  const resolved = resolvePetAnimation(petPackage, state, animationOverride || undefined);
  placeholder.src = fallback;
  placeholder.alt = `${title}动作预览`;
  placeholder.draggable = false;
  copy.className = "action-card-copy";
  heading.textContent = title;
  copy.append(heading);
  if (subtitle) {
    const detail = document.createElement("span");
    detail.textContent = subtitle;
    copy.append(detail);
  }
  previewSlot.append(placeholder);
  card.append(previewSlot, copy);

  void loadActionPreviewPoster(resolved.url, fallback).then((poster) => {
    if (placeholder.isConnected) {
      placeholder.src = poster;
    }
  });

  card.addEventListener("click", (event) => {
    event.stopPropagation();
    onActivate();
  });
  return card;
}

function mountActionPreview(
  previewSlot: HTMLElement,
  state: AgentState,
  animationOverride: string,
): void {
  previewSlot.prepend(actionPreviewImage);
  actionPreviewImage.hidden = false;
  actionPreviewRenderer.render(state, animationOverride || undefined);
}

function toggleAnimationChoices(
  item: HTMLElement,
  state: AgentState,
  choiceGrid: HTMLElement,
): void {
  const wasExpanded = item.dataset.expanded === "true";
  collapseStateAnimationChoices();
  if (wasExpanded) {
    const stateCard = item.querySelector<HTMLElement>(".state-action-card");
    if (stateCard) {
      mountActionPreview(
        stateCard.querySelector<HTMLElement>(".action-preview-slot")!,
        state,
        validStateAnimationOverride(state) ?? "",
      );
    }
    return;
  }

  const currentOverride = validStateAnimationOverride(state) ?? "";
  const candidates = [
    {
      animationOverride: "",
      title: "跟随资源包",
      animationId: petPackage.manifest.states[state],
    },
    ...petPackage.manifest.stateAnimationChoices[state]
      .filter((animationId) => animationId !== petPackage.manifest.states[state])
      .map((animationId) => ({
        animationOverride: animationId,
        title: animationId,
        animationId,
      })),
  ];
  choiceGrid.replaceChildren(
    ...candidates.map(({ animationOverride, title, animationId }) => {
      const card = createActionCard({
        className: "animation-choice-card",
        state,
        animationOverride,
        title,
        subtitle: animationOverride ? undefined : animationId,
        ariaLabel: `将${STATE_PRESENTATION[state].label}状态设置为${title}`,
        onActivate: () => selectStateAnimation(state, animationOverride),
      });
      card.dataset.animation = animationId;
      card.setAttribute("aria-pressed", String(animationOverride === currentOverride));
      return card;
    }),
  );
  item.dataset.expanded = "true";
  choiceGrid.hidden = false;
  item.querySelector<HTMLElement>(".state-action-card")?.setAttribute("aria-expanded", "true");
  const selectedCard = choiceGrid.querySelector<HTMLElement>('[aria-pressed="true"]');
  if (selectedCard) {
    mountActionPreview(
      selectedCard.querySelector<HTMLElement>(".action-preview-slot")!,
      state,
      currentOverride,
    );
  }
}

function selectStateAnimation(state: AgentState, animationOverride: string): void {
  const nextOverrides = { ...settings.stateAnimationOverrides };
  if (animationOverride) {
    nextOverrides[state] = animationOverride;
  } else {
    delete nextOverrides[state];
  }
  settings.stateAnimationOverrides = nextOverrides;
  if (state === currentEvent.state) {
    refreshPetPresentation();
  }
  runSettingsOperation(persistSettings(settings));
  populateStateAnimationControls(state);
  const item = stateAnimationGrid.querySelector<HTMLElement>(`.state-action-item[data-state="${state}"]`);
  const choiceGrid = item?.querySelector<HTMLElement>(".animation-choice-grid");
  if (item && choiceGrid) {
    toggleAnimationChoices(item, state, choiceGrid);
  }
}

function collapseStateAnimationChoices(): void {
  stateAnimationOverview.hidden = false;
  actionPreviewStaging.append(actionPreviewImage);
  for (const item of stateAnimationGrid.querySelectorAll<HTMLElement>(".state-action-item")) {
    item.dataset.expanded = "false";
    item.querySelector<HTMLElement>(".state-action-card")?.setAttribute("aria-expanded", "false");
    const choiceGrid = item.querySelector<HTMLElement>(".animation-choice-grid");
    if (choiceGrid) {
      choiceGrid.hidden = true;
      choiceGrid.replaceChildren();
    }
  }
}

async function changePetPackage(packageId: string): Promise<void> {
  petPackageInput.disabled = true;
  petPackageError.hidden = true;
  try {
    const nextPackage = selectPetPackage(petCatalog, packageId);
    petPackage = nextPackage;
    petRenderer.setPackage(nextPackage);
    actionPreviewRenderer.setPackage(nextPackage);
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
  return animationId && petPackage.manifest.stateAnimationChoices[state].includes(animationId)
    ? animationId
    : undefined;
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

async function updateLaunchAtStartup(launchAtStartup: boolean): Promise<void> {
  const previous = settings.launchAtStartup;
  settings.launchAtStartup = launchAtStartup;
  applySettingsPresentation(settings);
  try {
    await persistSettings(settings, true);
  } catch (error) {
    settings.launchAtStartup = previous;
    applySettingsPresentation(settings);
    throw error;
  }
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
  actionPreviewRenderer.setPackage(petPackage);
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
  requiredElement<HTMLOutputElement>("#scale-output").value = `${scalePercent}%`;
  requiredElement<HTMLOutputElement>("#opacity-output").value = `${opacityPercent}%`;
  requiredElement<HTMLInputElement>("#always-on-top-input").checked = nextSettings.alwaysOnTop;
  requiredElement<HTMLInputElement>("#launch-at-startup-input").checked =
    nextSettings.launchAtStartup;
  requiredElement<HTMLInputElement>("#bubble-input").checked = nextSettings.showStateBubble;
  petPackageInput.value = petPackage.catalogId;
  applyPetPackagePresentation();
}

async function applyNativeSettings(nextSettings: AppSettings): Promise<void> {
  await setAlwaysOnTop(nextSettings.alwaysOnTop);
  await applyWindowLayout(nextSettings.scale);
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

function closeSettingsFromOutside(event: MouseEvent): void {
  if (!shouldDismissSettingsFromTarget(!settingsPanel.hidden, event.target)) {
    return;
  }
  setSettingsOpen(false);
}

function setSettingsOpen(open: boolean): void {
  if (open) {
    onboardingPanel.hidden = true;
  } else {
    collapseStateAnimationChoices();
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

async function applyWindowLayout(scale: number): Promise<void> {
  app.dataset.sidePanelPlacement = await resizeWindowForScale(scale, sidePanelOpen());
}

function syncWindowLayout(): void {
  runSettingsOperation(
    applyWindowLayout(settings.scale),
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
