// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { PetInteractionController } from "./pet-interaction-controller";
import { TimedPetInteraction } from "./timed-pet-interaction";

describe("TimedPetInteraction", () => {
  beforeEach(() => vi.useFakeTimers());

  it("ends at the exact duration boundary", () => {
    const history: Array<string | null> = [];
    const controller = new PetInteractionController((value) => history.push(value));
    const interaction = createTimedInteraction(controller);

    interaction.trigger("clicked", 650);
    vi.advanceTimersByTime(649);
    expect(controller.currentInteractionId).toBe("clicked");
    vi.advanceTimersByTime(1);

    expect(controller.currentInteractionId).toBeNull();
    expect(history).toEqual(["clicked", null]);
  });

  it("refreshes repeated actions without stacking tokens or restarting the presentation", () => {
    const history: Array<string | null> = [];
    const controller = new PetInteractionController((value) => history.push(value));
    const interaction = createTimedInteraction(controller);

    interaction.trigger("clicked", 650);
    vi.advanceTimersByTime(500);
    interaction.trigger("clicked", 650);
    vi.advanceTimersByTime(649);
    expect(controller.currentInteractionId).toBe("clicked");
    vi.advanceTimersByTime(1);

    expect(history).toEqual(["clicked", null]);
  });

  it("restores a lower-priority interaction and disposes safely", () => {
    const history: Array<string | null> = [];
    const controller = new PetInteractionController((value) => history.push(value));
    const hovering = controller.begin("hovering");
    const interaction = createTimedInteraction(controller);

    interaction.trigger("clicked", 650);
    interaction.dispose();
    interaction.dispose();
    controller.end(hovering);

    expect(history).toEqual(["hovering", "clicked", "hovering", null]);
  });

  it("rejects durations that could leave an invalid timer", () => {
    const controller = new PetInteractionController(() => undefined);
    const interaction = createTimedInteraction(controller);

    expect(() => interaction.trigger("clicked", 0)).toThrow(/positive integer/);
    expect(() => interaction.trigger("clicked", 1.5)).toThrow(/positive integer/);
    expect(controller.currentInteractionId).toBeNull();
  });
});

function createTimedInteraction(controller: PetInteractionController): TimedPetInteraction {
  return new TimedPetInteraction(controller, {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (timerId) => window.clearTimeout(timerId),
  });
}
