import type { MutableRefObject, RefObject } from 'react';

const MAX_FRAME_POLL_ATTEMPTS = 10;

interface WebCodecsCanvasPollingOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rafIdRef: MutableRefObject<number>;
  lastDrawnTimeRef: MutableRefObject<number | null>;
  frameTimeMs: number;
  getFrame: (timestampMs: number) => ImageBitmap | null;
  setHasFrame: (hasFrame: boolean) => void;
}

function drawFrameIfNeeded(
  canvas: HTMLCanvasElement,
  frame: ImageBitmap,
  frameTimeMs: number,
  lastDrawnTimeRef: MutableRefObject<number | null>,
) {
  if (lastDrawnTimeRef.current === frameTimeMs) return;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  if (canvas.width !== frame.width || canvas.height !== frame.height) {
    canvas.width = frame.width;
    canvas.height = frame.height;
  }
  ctx.drawImage(frame, 0, 0);
  lastDrawnTimeRef.current = frameTimeMs;
}

export function startWebCodecsCanvasPolling({
  canvasRef,
  rafIdRef,
  lastDrawnTimeRef,
  frameTimeMs,
  getFrame,
  setHasFrame,
}: WebCodecsCanvasPollingOptions) {
  let active = true;
  let attempts = 0;

  const tryDraw = () => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const frame = getFrame(frameTimeMs);
    if (frame) {
      drawFrameIfNeeded(canvas, frame, frameTimeMs, lastDrawnTimeRef);
      setHasFrame(true);
      return;
    }

    attempts++;
    if (attempts >= MAX_FRAME_POLL_ATTEMPTS) {
      setHasFrame(false);
      return;
    }
    rafIdRef.current = requestAnimationFrame(tryDraw);
  };

  tryDraw();

  return () => {
    active = false;
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
  };
}
