import { describe, expect, it, vi } from "vitest";

import { PetInteractionController } from "./pet-interaction-controller";

describe("PetInteractionController", () => {
  it("publishes the newest active interaction and restores the previous one", () => {
    const onChange = vi.fn();
    const controller = new PetInteractionController(onChange);

    const hovering = controller.begin("hovering");
    const dragging = controller.begin("dragging");
    controller.end(dragging);
    controller.end(hovering);

    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      "hovering",
      "dragging",
      "hovering",
      null,
    ]);
    expect(controller.currentInteractionId).toBeNull();
  });

  it("ignores stale completions and does not flicker for nested copies of one action", () => {
    const onChange = vi.fn();
    const controller = new PetInteractionController(onChange);
    const first = controller.begin("dragging");
    const second = controller.begin("dragging");

    controller.end(first);
    controller.end(first);
    expect(controller.currentInteractionId).toBe("dragging");
    controller.end(second);

    expect(onChange.mock.calls.map(([value]) => value)).toEqual(["dragging", null]);
  });

  it("clears every active interaction as one deterministic restoration", () => {
    const onChange = vi.fn();
    const controller = new PetInteractionController(onChange);
    controller.begin("dragging");
    controller.begin("hovering");

    controller.clear();
    controller.clear();

    expect(onChange.mock.calls.map(([value]) => value)).toEqual([
      "dragging",
      "hovering",
      null,
    ]);
  });
});
