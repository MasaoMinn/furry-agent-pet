import type { PetStateVariant } from "../domain/pet-package";

export interface StateVariantTimerApi {
  setTimeout(callback: () => void, delayMs: number): number;
  clearTimeout(timerId: number): void;
}

export interface StateVariantSchedule {
  variants: readonly PetStateVariant[];
  disabled: boolean;
  isCurrent: () => boolean;
  activate: (animationId: string) => void;
}

export class StateVariantScheduler {
  private timerIds: number[] = [];
  private generation = 0;

  constructor(private readonly timers: StateVariantTimerApi) {}

  schedule({ variants, disabled, isCurrent, activate }: StateVariantSchedule): void {
    this.clear();
    if (disabled) {
      return;
    }

    const scheduledGeneration = this.generation;
    this.timerIds = variants.map(({ animation, activateAfterMs }) =>
      this.timers.setTimeout(() => {
        if (this.generation === scheduledGeneration && isCurrent()) {
          activate(animation);
        }
      }, activateAfterMs),
    );
  }

  clear(): void {
    this.generation += 1;
    for (const timerId of this.timerIds) {
      this.timers.clearTimeout(timerId);
    }
    this.timerIds = [];
  }
}
