import type { AgentState } from "../domain/agent-state";
import {
  resolvePetAnimation,
  resolvePetAnimationById,
  type LoadedPetPackage,
  type ResolvedPetAnimation,
} from "../domain/pet-package";

export class PetRenderer {
  private static readonly FALLBACK_ID = "__static-fallback__";
  private static readonly REDUCED_MOTION_ID = "__reduced-motion-fallback__";
  private static readonly FALLBACK_ALT = "桌宠动画资源不可用，正在显示备用静态图标";

  private currentAnimationId = "";
  private requestedAnimation: ResolvedPetAnimation | null = null;
  private reducedMotion = false;
  private readonly failedAnimationIds = new Set<string>();

  constructor(
    private readonly image: HTMLImageElement,
    private petPackage: LoadedPetPackage,
    private readonly fallbackUrl = "",
  ) {
    image.addEventListener("error", this.handleImageError);
  }

  setPackage(petPackage: LoadedPetPackage): void {
    this.petPackage = petPackage;
    this.currentAnimationId = "";
    this.requestedAnimation = null;
    this.failedAnimationIds.clear();
  }

  setReducedMotion(enabled: boolean): boolean {
    if (this.reducedMotion === enabled) {
      return false;
    }
    this.reducedMotion = enabled;
    return this.requestedAnimation
      ? this.renderRequestedAnimation()
      : false;
  }

  render(state: AgentState, animationOverride?: string): boolean {
    return this.renderResolvedAnimation(resolvePetAnimation(this.petPackage, state, animationOverride));
  }

  renderAnimation(animationId: string): boolean {
    return this.renderResolvedAnimation(resolvePetAnimationById(this.petPackage, animationId));
  }

  private renderResolvedAnimation(animation: ResolvedPetAnimation): boolean {
    this.requestedAnimation = animation;
    return this.renderRequestedAnimation();
  }

  private renderRequestedAnimation(): boolean {
    const animation = this.requestedAnimation;
    if (!animation) {
      return false;
    }
    if (this.reducedMotion && animation.mediaType === "image/gif") {
      const reducedMotionAnimationId = this.petPackage.manifest.reducedMotionAnimations[animation.id];
      if (reducedMotionAnimationId) {
        return this.renderMediaAnimation(
          resolvePetAnimationById(this.petPackage, reducedMotionAnimationId),
        );
      }
      return this.renderReducedMotionFallback(animation);
    }
    return this.renderMediaAnimation(animation);
  }

  private renderMediaAnimation(animation: ResolvedPetAnimation): boolean {
    if (this.failedAnimationIds.has(animation.id)) {
      return this.renderFallback();
    }
    const changed = this.currentAnimationId !== animation.id;

    if (changed) {
      this.currentAnimationId = animation.id;
      // GIF repetition is intrinsic to the media. Rust validates imported
      // packages so the embedded repeat metadata agrees with manifest.loop;
      // assigning the URL lets the platform decoder honor finite or infinite
      // playback without a permanent JavaScript timer.
      this.image.src = animation.url;
    }
    this.image.alt = animation.alt;
    return changed;
  }

  private readonly handleImageError = (): void => {
    if (
      this.currentAnimationId === PetRenderer.FALLBACK_ID ||
      this.currentAnimationId === PetRenderer.REDUCED_MOTION_ID
    ) {
      this.image.removeAttribute("src");
      return;
    }
    if (this.currentAnimationId) {
      this.failedAnimationIds.add(this.currentAnimationId);
    }
    this.renderFallback();
  };

  private renderReducedMotionFallback(animation: ResolvedPetAnimation): boolean {
    const changed = this.currentAnimationId !== PetRenderer.REDUCED_MOTION_ID;
    this.currentAnimationId = PetRenderer.REDUCED_MOTION_ID;
    this.image.alt = `${animation.alt}（已减少动态效果）`;
    if (this.fallbackUrl && this.image.src !== this.fallbackUrl) {
      this.image.src = this.fallbackUrl;
    } else if (!this.fallbackUrl) {
      this.image.removeAttribute("src");
    }
    return changed;
  }

  private renderFallback(): boolean {
    const changed = this.currentAnimationId !== PetRenderer.FALLBACK_ID;
    this.currentAnimationId = PetRenderer.FALLBACK_ID;
    this.image.alt = PetRenderer.FALLBACK_ALT;
    if (this.fallbackUrl && this.image.src !== this.fallbackUrl) {
      this.image.src = this.fallbackUrl;
    } else if (!this.fallbackUrl) {
      this.image.removeAttribute("src");
    }
    return changed;
  }
}
