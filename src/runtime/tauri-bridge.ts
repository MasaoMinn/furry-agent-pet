import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  currentMonitor,
  getCurrentWindow,
  LogicalSize,
  PhysicalPosition,
} from "@tauri-apps/api/window";

import type { AgentStateEvent } from "../domain/agent-state";
import type { PointerCaptureRegion } from "../ui/pointer-capture-regions";
import {
  resolveSidePanelLayout,
  type SidePanelPlacement,
} from "../domain/side-panel-placement";
import { PROJECT_INTRO_URL } from "../domain/project-intro";

const SIDE_PANEL_LOGICAL_WIDTH = 328;

let previousPanelOpen = false;
let previousPanelPlacement: SidePanelPlacement = "right";

export type ConnectionStatus = "connecting" | "connected" | "disconnected" | "disabled";

export interface RuntimeSnapshot {
  revision: number;
  status: ConnectionStatus;
  endpoint: string;
  lastEventAtMs: number | null;
  lastError: string | null;
}

export interface RuntimeHandlers {
  onState: (event: AgentStateEvent) => void;
  onConnection: (snapshot: RuntimeSnapshot) => void;
  onOpenSettings?: () => void;
  onAlwaysOnTopChanged?: (alwaysOnTop: boolean) => void;
  onPointerCaptureLeave?: () => void;
}

export interface WindowDragResult {
  native: boolean;
  releasedWithinTimeout: boolean;
  deltaX: number;
  deltaY: number;
}

export async function subscribeToRuntime(handlers: RuntimeHandlers): Promise<() => void> {
  if (!isTauri()) {
    return subscribeToBrowserDemo(handlers);
  }

  const unlisteners: UnlistenFn[] = [];
  unlisteners.push(
    await listen<AgentStateEvent>("agent-state", ({ payload }) => handlers.onState(payload)),
  );
  unlisteners.push(
    await listen<RuntimeSnapshot>("connection-status", ({ payload }) =>
      handlers.onConnection(payload),
    ),
  );
  unlisteners.push(
    await listen("open-settings", () => handlers.onOpenSettings?.()),
  );
  unlisteners.push(
    await listen<boolean>("always-on-top-changed", ({ payload }) =>
      handlers.onAlwaysOnTopChanged?.(payload),
    ),
  );
  unlisteners.push(
    await listen("pointer-capture-left", () => handlers.onPointerCaptureLeave?.()),
  );

  handlers.onConnection(await invoke<RuntimeSnapshot>("get_runtime_snapshot"));

  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}

export async function configureIpc(address: string, enabled: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("set_ipc_config", { address, enabled });
  }
}

export async function reconnectIpc(): Promise<void> {
  if (isTauri()) {
    await invoke("reconnect_ipc");
  }
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<void> {
  if (isTauri()) {
    await invoke("set_always_on_top", { alwaysOnTop });
  }
}

export async function setPointerCaptureRegions(
  regions: readonly PointerCaptureRegion[],
): Promise<void> {
  if (isTauri()) {
    await invoke("set_pointer_capture_regions", { regions });
  }
}

export async function resizeWindowForScale(
  scale: number,
  sidePanelOpen = false,
): Promise<SidePanelPlacement> {
  if (!isTauri()) {
    previousPanelOpen = sidePanelOpen;
    return previousPanelPlacement;
  }

  const extraWidth = Math.max(0, 286 * scale - 286);
  const extraHeight = Math.max(0, 272 * scale - 272);
  const petLogicalWidth = Math.round(360 + extraWidth);
  const targetSize = new LogicalSize(
    petLogicalWidth + (sidePanelOpen ? SIDE_PANEL_LOGICAL_WIDTH : 0),
    Math.round(440 + extraHeight),
  );
  const window = getCurrentWindow();
  const [position, scaleFactor, monitor] = await Promise.all([
    window.outerPosition(),
    window.scaleFactor(),
    currentMonitor(),
  ]);

  if (!monitor) {
    await window.setSize(targetSize);
    previousPanelOpen = sidePanelOpen;
    return previousPanelPlacement;
  }

  const layout = resolveSidePanelLayout({
    currentWindowLeft: position.x,
    petWidth: Math.round(petLogicalWidth * scaleFactor),
    panelWidth: Math.round(SIDE_PANEL_LOGICAL_WIDTH * scaleFactor),
    workAreaLeft: monitor.workArea.position.x,
    workAreaWidth: monitor.workArea.size.width,
    panelOpen: sidePanelOpen,
    previousPanelOpen,
    previousPlacement: previousPanelPlacement,
  });
  const targetPosition = new PhysicalPosition(layout.windowLeft, position.y);

  if (previousPanelOpen && !sidePanelOpen) {
    await window.setSize(targetSize);
    await window.setPosition(targetPosition);
  } else {
    await window.setPosition(targetPosition);
    await window.setSize(targetSize);
  }

  previousPanelOpen = sidePanelOpen;
  previousPanelPlacement = layout.placement;
  return layout.placement;
}

export async function startWindowDrag(
  releaseTimeoutMs = 300,
): Promise<WindowDragResult> {
  if (!isTauri()) {
    return { native: false, releasedWithinTimeout: false, deltaX: 0, deltaY: 0 };
  }
  const result = await invoke<Omit<WindowDragResult, "native">>("start_tracked_window_drag", {
    timeoutMs: releaseTimeoutMs,
  });
  return {
    native: true,
    ...result,
  };
}

export async function quitApplication(): Promise<void> {
  if (isTauri()) {
    await invoke("quit_app");
  }
}

export async function openProjectIntro(): Promise<void> {
  if (isTauri()) {
    await openUrl(PROJECT_INTRO_URL);
    return;
  }
  window.open(PROJECT_INTRO_URL, "_blank", "noopener,noreferrer");
}

function subscribeToBrowserDemo(handlers: RuntimeHandlers): () => void {
  handlers.onConnection({
    status: "disconnected",
    revision: 0,
    endpoint: "浏览器预览模式",
    lastEventAtMs: null,
    lastError: null,
  });

  const params = new URLSearchParams(location.search);
  if (params.get("demo") !== "1") {
    return () => undefined;
  }

  const demoStates: AgentStateEvent[] = [
    { type: "state", state: "thinking", sessionTitle: "浏览器演示", message: "正在理解你的需求。" },
    { type: "state", state: "planning", sessionTitle: "浏览器演示", message: "正在整理实现步骤。" },
    { type: "state", state: "coding", sessionTitle: "浏览器演示", message: "正在编写状态渲染器。", file: "src/main.ts" },
    { type: "state", state: "testing", sessionTitle: "浏览器演示", message: "正在运行端到端检查。" },
    { type: "state", state: "error", sessionTitle: "浏览器演示", message: "演示一个需要用户确认的错误状态。" },
    {
      type: "state",
      state: "success",
      sessionTitle: "浏览器演示",
      message: "桌宠的资源映射和状态展示已经完成，可以开始体验了。",
    },
  ];
  let index = 0;
  handlers.onConnection({
    status: "connected",
    revision: 1,
    endpoint: "浏览器演示事件",
    lastEventAtMs: Date.now(),
    lastError: null,
  });
  handlers.onState(demoStates[index]);

  const interval = window.setInterval(() => {
    index = (index + 1) % demoStates.length;
    handlers.onState(demoStates[index]);
  }, 3_500);

  return () => window.clearInterval(interval);
}
