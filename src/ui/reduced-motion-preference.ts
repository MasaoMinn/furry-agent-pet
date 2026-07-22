export class ReducedMotionPreference {
  private effective = false;

  constructor(private readonly onChange: (enabled: boolean) => void) {}

  get enabled(): boolean {
    return this.effective;
  }

  setSystemRequested(enabled: boolean): void {
    if (enabled === this.effective) {
      return;
    }
    this.effective = enabled;
    this.onChange(enabled);
  }
}
