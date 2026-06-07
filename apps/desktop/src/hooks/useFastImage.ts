/**
 * Hook for fast image loading from raw RGBA files.
 *
 * This hook provides a similar API to react-konva's useImage but optimized
 * for our fast capture path that skips PNG encoding entirely.
 *
 * Key insight: Konva can use HTMLCanvasElement as image source, not just HTMLImageElement.
 * By drawing raw RGBA directly to a canvas, we skip all image encoding.
 */

import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import { readFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

/**
 * Clean up temp RGBA file after successful load.
 * Uses a small delay to ensure save_capture_from_file has finished reading.
 */
async function cleanupTempFile(filePath: string): Promise<void> {
  // Small delay to ensure Rust save operation has finished reading the file
  await new Promise(resolve => setTimeout(resolve, 500));
  try {
    await invoke('cleanup_rgba_file', { filePath });
  } catch {
    // Ignore cleanup errors - file might already be deleted or in use
  }
}

type ImageSource = HTMLImageElement | HTMLCanvasElement;

interface FastImageState {
  image: ImageSource | null;
  status: 'loading' | 'loaded' | 'error';
  width: number;
  height: number;
}

const INITIAL_FAST_IMAGE_STATE: FastImageState = {
  image: null,
  status: 'loading',
  width: 0,
  height: 0,
};

const ERROR_FAST_IMAGE_STATE: FastImageState = {
  image: null,
  status: 'error',
  width: 0,
  height: 0,
};

/**
 * Load raw RGBA from file and draw directly to canvas - NO PNG encoding!
 */
async function loadRgbaToCanvas(filePath: string): Promise<{
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}> {
  // Read the raw file
  const data = await readFile(filePath);

  const buffer = data.buffer;
  const view = new DataView(buffer);

  // Parse header (8 bytes: width u32 LE, height u32 LE)
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);

  // Extract RGBA data (after 8-byte header)
  const rgbaData = new Uint8ClampedArray(buffer, 8);

  // Create ImageData from raw RGBA
  const imageData = new ImageData(rgbaData, width, height);

  // Draw directly to canvas - NO PNG ENCODING!
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(imageData, 0, 0);

  return { canvas, width, height };
}

function getDataImageUrl(source: string) {
  return source.startsWith('data:') ? source : `data:image/png;base64,${source}`;
}

async function loadDataImage(source: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = getDataImageUrl(source);

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
  });

  return img;
}

async function loadRgbaImageState(source: string): Promise<FastImageState> {
  const { canvas, width, height } = await loadRgbaToCanvas(source);
  return { image: canvas, status: 'loaded', width, height };
}

async function loadDataImageState(source: string): Promise<FastImageState> {
  const img = await loadDataImage(source);
  return {
    image: img,
    status: 'loaded',
    width: img.naturalWidth,
    height: img.naturalHeight,
  };
}

function isRgbaSource(source: string) {
  return source.endsWith('.rgba');
}

async function loadFastImageState(source: string): Promise<FastImageState> {
  return isRgbaSource(source)
    ? loadRgbaImageState(source)
    : loadDataImageState(source);
}

function rememberLoadedImageResources(
  nextState: FastImageState,
  source: string,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>,
  imageRef: MutableRefObject<HTMLImageElement | null>
) {
  if (nextState.image instanceof HTMLCanvasElement) {
    canvasRef.current = nextState.image;
    cleanupTempFile(source);
    return;
  }

  if (nextState.image instanceof HTMLImageElement) {
    imageRef.current = nextState.image;
  }
}

/**
 * Load an image from either a base64 string or a raw RGBA file path.
 * For RGBA files, returns an HTMLCanvasElement (which Konva supports).
 * For base64, returns an HTMLImageElement.
 *
 * @param source Either a base64 string or a file path to .rgba file
 * @returns [image, status] tuple compatible with useImage
 */
export function useFastImage(
  source: string | null
): [ImageSource | null, 'loading' | 'loaded' | 'error'] {
  const [state, setState] = useState<FastImageState>(INITIAL_FAST_IMAGE_STATE);

  // Track resources for cleanup
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!source) {
      setState(INITIAL_FAST_IMAGE_STATE);
      return;
    }

    let isMounted = true;

    const loadImage = async () => {
      try {
        const nextState = await loadFastImageState(source);
        if (!isMounted) return;

        rememberLoadedImageResources(nextState, source, canvasRef, imageRef);
        setState(nextState);
      } catch {
        if (isMounted) {
          setState(ERROR_FAST_IMAGE_STATE);
        }
      }
    };

    loadImage();

    return () => {
      isMounted = false;
      // Just null the refs - don't mutate dimensions as Konva may still reference them
      // Browser will garbage collect when there are no more references
      canvasRef.current = null;
      imageRef.current = null;
    };
  }, [source]);

  return [state.image, state.status];
}

/**
 * Hook to cleanup an RGBA file when it's no longer needed.
 * Call this after the image has been saved to permanent storage.
 */
export function useRgbaCleanup(filePath: string | null): () => Promise<void> {
  return async () => {
    if (filePath && filePath.endsWith('.rgba')) {
      try {
        await invoke('cleanup_rgba_file', { filePath });
      } catch {
        // Failed to cleanup temp file - will be cleaned on next startup
      }
    }
  };
}
