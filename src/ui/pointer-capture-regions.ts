export interface PointerCaptureRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface LogicalRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PET_MASK_CELL_SIZE = 10;
const PET_MASK_ALPHA_THRESHOLD = 20;
const PET_MASK_PADDING_CELLS = 1;
const MAX_PET_MASK_REGIONS = 240;

export function pointerCaptureRegions(
  elements: readonly Element[],
  scaleFactor: number,
): PointerCaptureRegion[] {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return elements.flatMap((element) => {
    if (!(element instanceof HTMLElement) || element.hidden) {
      return [];
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return [];
    }
    return [{
      left: Math.floor(rect.left * scale),
      top: Math.floor(rect.top * scale),
      width: Math.max(1, Math.ceil(rect.right * scale) - Math.floor(rect.left * scale)),
      height: Math.max(1, Math.ceil(rect.bottom * scale) - Math.floor(rect.top * scale)),
    }];
  });
}

export function petImageCaptureRegions(
  image: HTMLImageElement,
  fallbackElement: HTMLElement,
  scaleFactor: number,
): PointerCaptureRegion[] {
  const masked = alphaImageRegions(image, scaleFactor);
  if (masked.length > 0) {
    return masked;
  }

  const rect = fallbackElement.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return [];
  }
  const horizontalInset = rect.width * 0.18;
  const topInset = rect.height * 0.1;
  return logicalRegionsToPhysical([
    {
      left: rect.left + horizontalInset,
      top: rect.top + topInset,
      width: rect.width - horizontalInset * 2,
      height: rect.height - topInset,
    },
  ], scaleFactor);
}

function alphaImageRegions(
  image: HTMLImageElement,
  scaleFactor: number,
): PointerCaptureRegion[] {
  const rect = image.getBoundingClientRect();
  if (!image.complete || image.naturalWidth <= 0 || image.naturalHeight <= 0 || rect.width <= 0 || rect.height <= 0) {
    return [];
  }

  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return [];
  }

  try {
    const { left, top, width: drawWidth, height: drawHeight } = renderedImageRect(
      image,
      width,
      height,
    );
    context.drawImage(image, left, top, drawWidth, drawHeight);
    const pixels = context.getImageData(0, 0, width, height).data;
    for (const cellSize of [PET_MASK_CELL_SIZE, 14, 20, 28]) {
      const logical = alphaPixelsToRegions(
        pixels,
        width,
        height,
        cellSize,
        PET_MASK_ALPHA_THRESHOLD,
        PET_MASK_PADDING_CELLS,
      );
      if (logical.length <= MAX_PET_MASK_REGIONS) {
        return logicalRegionsToPhysical(
          logical.map((region) => ({
            ...region,
            left: region.left + rect.left,
            top: region.top + rect.top,
          })),
          scaleFactor,
        );
      }
    }
    return [];
  } catch {
    // Custom asset protocols may intentionally prevent canvas pixel reads.
    return [];
  }
}

function renderedImageRect(
  image: HTMLImageElement,
  boxWidth: number,
  boxHeight: number,
): LogicalRegion {
  const style = getComputedStyle(image);
  const fit = style.objectFit;
  if (fit === "fill") {
    return { left: 0, top: 0, width: boxWidth, height: boxHeight };
  }

  const containScale = Math.min(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
  const coverScale = Math.max(boxWidth / image.naturalWidth, boxHeight / image.naturalHeight);
  const scale = fit === "cover" ? coverScale : fit === "none" ? 1 : containScale;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const [positionX, positionY] = objectPositionFactors(style.objectPosition);
  return {
    left: (boxWidth - width) * positionX,
    top: (boxHeight - height) * positionY,
    width,
    height,
  };
}

function objectPositionFactors(value: string): [number, number] {
  const [x = "50%", y = "50%"] = value.trim().split(/\s+/);
  return [positionFactor(x, 0.5), positionFactor(y, 0.5)];
}

function positionFactor(value: string, fallback: number): number {
  if (value === "left" || value === "top") return 0;
  if (value === "right" || value === "bottom") return 1;
  if (value === "center") return 0.5;
  if (value.endsWith("%")) {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed / 100;
  }
  return fallback;
}

export function alphaPixelsToRegions(
  rgba: ArrayLike<number>,
  width: number,
  height: number,
  cellSize: number,
  alphaThreshold: number,
  paddingCells: number,
): LogicalRegion[] {
  const columns = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const occupied = Array.from({ length: rows }, () => Array<boolean>(columns).fill(false));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) > alphaThreshold) {
        occupied[Math.floor(y / cellSize)][Math.floor(x / cellSize)] = true;
      }
    }
  }

  const padded = occupied.map((row) => [...row]);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!occupied[row][column]) continue;
      for (let dy = -paddingCells; dy <= paddingCells; dy += 1) {
        for (let dx = -paddingCells; dx <= paddingCells; dx += 1) {
          const targetRow = row + dy;
          const targetColumn = column + dx;
          if (targetRow >= 0 && targetRow < rows && targetColumn >= 0 && targetColumn < columns) {
            padded[targetRow][targetColumn] = true;
          }
        }
      }
    }
  }

  const regions: LogicalRegion[] = [];
  const active = new Map<string, LogicalRegion>();
  for (let row = 0; row < rows; row += 1) {
    const runs: Array<[number, number]> = [];
    for (let column = 0; column < columns;) {
      if (!padded[row][column]) {
        column += 1;
        continue;
      }
      const start = column;
      while (column < columns && padded[row][column]) column += 1;
      runs.push([start, column]);
    }

    const next = new Map<string, LogicalRegion>();
    for (const [start, end] of runs) {
      const key = `${start}:${end}`;
      const existing = active.get(key);
      const region = existing ?? {
        left: start * cellSize,
        top: row * cellSize,
        width: Math.min(width, end * cellSize) - start * cellSize,
        height: 0,
      };
      region.height = Math.min(height, (row + 1) * cellSize) - region.top;
      next.set(key, region);
    }
    for (const [key, region] of active) {
      if (!next.has(key)) regions.push(region);
    }
    active.clear();
    for (const [key, region] of next) active.set(key, region);
  }
  regions.push(...active.values());
  return regions;
}

function logicalRegionsToPhysical(
  regions: readonly LogicalRegion[],
  scaleFactor: number,
): PointerCaptureRegion[] {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return regions.map((rect) => ({
    left: Math.floor(rect.left * scale),
    top: Math.floor(rect.top * scale),
    width: Math.max(1, Math.ceil((rect.left + rect.width) * scale) - Math.floor(rect.left * scale)),
    height: Math.max(1, Math.ceil((rect.top + rect.height) * scale) - Math.floor(rect.top * scale)),
  }));
}
