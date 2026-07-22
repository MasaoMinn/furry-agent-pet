import {
  type PetInteractionToken,
  PetInteractionController,
} from "./pet-interaction-controller";

export interface TimedInteractionScheduler {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export class TimedPetInteraction {
  private token: PetInteractionToken | null = null;
  private timerId: number | null = null;
  private interactionId: string | null = null;

  constructor(
    private readonly controller: PetInteractionController,
    private readonly scheduler: TimedInteractionScheduler,
  ) {}

  trigger(interactionId: string, durationMs: number): void {
    if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
      throw new Error("Timed pet interaction duration must be a positive integer");
    }
    if (this.token !== null && this.interactionId !== interactionId) {
      this.finish();
    }
    if (this.token === null) {
      this.token = this.controller.begin(interactionId);
      this.interactionId = interactionId;
    }
    if (this.timerId !== null) {
      this.scheduler.clearTimeout(this.timerId);
    }
    this.timerId = this.scheduler.setTimeout(() => this.finish(), durationMs);
  }

  dispose(): void {
    this.finish();
  }

  private finish(): void {
    if (this.timerId !== null) {
      this.scheduler.clearTimeout(this.timerId);
      this.timerId = null;
    }
    const token = this.token;
    this.token = null;
    this.interactionId = null;
    if (token !== null) {
      this.controller.end(token);
    }
  }
}
