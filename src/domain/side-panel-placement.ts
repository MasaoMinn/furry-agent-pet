export type SidePanelPlacement = "left" | "right";

export interface SidePanelLayoutInput {
  currentWindowLeft: number;
  petWidth: number;
  panelWidth: number;
  workAreaLeft: number;
  workAreaWidth: number;
  panelOpen: boolean;
  previousPanelOpen: boolean;
  previousPlacement: SidePanelPlacement;
}

export interface SidePanelLayout {
  placement: SidePanelPlacement;
  windowLeft: number;
  petLeft: number;
}

export function resolveSidePanelLayout(input: SidePanelLayoutInput): SidePanelLayout {
  const workAreaRight = input.workAreaLeft + input.workAreaWidth;
  const petLeft =
    input.previousPanelOpen && input.previousPlacement === "left"
      ? input.currentWindowLeft + input.panelWidth
      : input.currentWindowLeft;

  if (!input.panelOpen) {
    return {
      placement: input.previousPlacement,
      windowLeft: clampWindowLeft(
        petLeft,
        input.petWidth,
        input.workAreaLeft,
        workAreaRight,
      ),
      petLeft,
    };
  }

  const totalWidth = input.petWidth + input.panelWidth;
  const rightCandidate = petLeft;
  const leftCandidate = petLeft - input.panelWidth;
  const rightOverflow = overflow(rightCandidate, totalWidth, input.workAreaLeft, workAreaRight);
  const leftOverflow = overflow(leftCandidate, totalWidth, input.workAreaLeft, workAreaRight);
  const placement: SidePanelPlacement = rightOverflow <= leftOverflow ? "right" : "left";
  const candidate = placement === "right" ? rightCandidate : leftCandidate;

  return {
    placement,
    windowLeft: clampWindowLeft(candidate, totalWidth, input.workAreaLeft, workAreaRight),
    petLeft,
  };
}

function overflow(left: number, width: number, workLeft: number, workRight: number): number {
  return Math.max(0, workLeft - left) + Math.max(0, left + width - workRight);
}

function clampWindowLeft(
  left: number,
  width: number,
  workLeft: number,
  workRight: number,
): number {
  if (width >= workRight - workLeft) {
    return workLeft;
  }
  return Math.min(workRight - width, Math.max(workLeft, left));
}
