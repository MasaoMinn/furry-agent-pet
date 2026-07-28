import { beforeEach, describe, expect, it, vi } from "vitest";

const { openUrlMock } = vi.hoisted(() => ({
  openUrlMock: vi.fn<(_url: string) => Promise<void>>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  currentMonitor: vi.fn(),
  getCurrentWindow: vi.fn(),
  LogicalSize: class {},
  PhysicalPosition: class {},
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openUrlMock,
}));

import { PROJECT_INTRO_URL } from "../domain/project-intro";
import { openProjectIntro } from "./tauri-bridge";

describe("openProjectIntro", () => {
  beforeEach(() => {
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue();
  });

  it("opens only the approved project page through Tauri Opener", async () => {
    await openProjectIntro();
    expect(openUrlMock).toHaveBeenCalledOnce();
    expect(openUrlMock).toHaveBeenCalledWith(PROJECT_INTRO_URL);
  });
});
