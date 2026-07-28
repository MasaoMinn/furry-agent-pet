const previewPosterCache = new Map<string, Promise<string>>();

export interface PreviewDimensions {
  width: number;
  height: number;
}

export function fitPreviewDimensions(
  width: number,
  height: number,
  maxWidth = 160,
  maxHeight = 120,
): PreviewDimensions {
  if (width <= 0 || height <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    return { width: 1, height: 1 };
  }
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function loadActionPreviewPoster(source: string, fallback: string): Promise<string> {
  const cached = previewPosterCache.get(source);
  if (cached) {
    return cached;
  }

  const poster = createActionPreviewPoster(source).catch(() => fallback);
  previewPosterCache.set(source, poster);
  return poster;
}

async function createActionPreviewPoster(source: string): Promise<string> {
  if (!/\.gif(?:$|[?#])/i.test(source)) {
    return source;
  }

  const response = await fetch(source);
  if (!response.ok) {
    throw new Error(`Unable to load action preview: ${response.status}`);
  }
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const dimensions = fitPreviewDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D is unavailable");
    }
    context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
    return canvas.toDataURL("image/png");
  } finally {
    bitmap.close();
  }
}
