export type PetInteractionToken = symbol;

export class PetInteractionController {
  private readonly active = new Map<PetInteractionToken, string>();
  private current: string | null = null;

  constructor(private readonly onChange: (interactionId: string | null) => void) {}

  get currentInteractionId(): string | null {
    return this.current;
  }

  begin(interactionId: string): PetInteractionToken {
    const token = Symbol(interactionId);
    this.active.set(token, interactionId);
    this.publishIfChanged();
    return token;
  }

  end(token: PetInteractionToken): void {
    if (!this.active.delete(token)) {
      return;
    }
    this.publishIfChanged();
  }

  clear(): void {
    if (this.active.size === 0) {
      return;
    }
    this.active.clear();
    this.publishIfChanged();
  }

  private publishIfChanged(): void {
    let next: string | null = null;
    for (const interactionId of this.active.values()) {
      next = interactionId;
    }
    if (next === this.current) {
      return;
    }
    this.current = next;
    this.onChange(next);
  }
}
