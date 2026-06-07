/**
 * WebCodecs decoder worker - handles video frame decoding off main thread.
 *
 * Uses mediabunny for hardware-accelerated WebCodecs decoding.
 * Frames are converted to ImageBitmap and transferred (not copied) to main thread.
 */

import { Input, ALL_FORMATS, UrlSource, VideoSampleSink } from 'mediabunny';
import type { InputVideoTrack } from 'mediabunny';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
  DecodeFrameMessage,
} from './webcodecs-decoder.types';

// State
let input: Input<UrlSource> | null = null;
let sink: VideoSampleSink | null = null;
let videoTrack: InputVideoTrack | null = null;
let durationMs = 0;
let isDisposed = false; // Prevents race conditions during async init

// Decode queue - prioritizes immediate requests over prefetch
const pendingDecodes = new Map<number, DecodeFrameMessage>();
let isDecoding = false;
let latestImmediateRequestId = 0;

// Worker-side cache to avoid re-decoding recently accessed frames
const workerFrameCache = new Map<number, ImageBitmap>();
const WORKER_CACHE_SIZE = 10;

/**
 * Send typed message to main thread
 */
function postTypedMessage(
  message: WorkerToMainMessage,
  transfer?: Transferable[]
): void {
  self.postMessage(message, { transfer });
}

/**
 * Initialize mediabunny with the video URL
 */
async function handleInit(videoUrl: string, maxCacheSize: number): Promise<void> {
  try {
    // Clean up previous state if re-initializing
    dispose();
    isDisposed = false; // Reset disposed flag for new init

    const source = new UrlSource(videoUrl, {
      maxCacheSize,
    });

    input = new Input({
      formats: ALL_FORMATS,
      source,
    });

    // Check if disposed during async operations
    if (isDisposed) return;

    videoTrack = await input.getPrimaryVideoTrack();
    if (isDisposed) return; // Check again after async

    if (!videoTrack) {
      throw new Error('No video track found');
    }

    const canDecode = await videoTrack.canDecode();
    if (isDisposed) return;

    if (!canDecode) {
      throw new Error('Video codec not supported by WebCodecs');
    }

    const duration = await videoTrack.computeDuration();
    if (isDisposed) return;

    durationMs = duration * 1000;

    sink = new VideoSampleSink(videoTrack);

    // Final check before sending ready
    if (isDisposed) return;

    postTypedMessage({
      type: 'ready',
      dimensions: {
        width: videoTrack.displayWidth,
        height: videoTrack.displayHeight,
      },
      durationMs,
    });
  } catch (err) {
    // Don't report errors if we were disposed during init
    if (isDisposed) return;

    postTypedMessage({
      type: 'init-error',
      error: err instanceof Error ? err.message : 'Failed to initialize',
    });
  }
}

/**
 * Decode a frame and transfer ImageBitmap to main thread
 */
function postFrameError(msg: DecodeFrameMessage, error: string): void {
  postTypedMessage({
    type: 'frame-error',
    requestId: msg.requestId,
    timestampMs: msg.timestampMs,
    error,
  });
}

function postDecodedFrame(msg: DecodeFrameMessage, bitmap: ImageBitmap): void {
  postTypedMessage(
    {
      type: 'frame-decoded',
      requestId: msg.requestId,
      timestampMs: msg.timestampMs,
      bitmap,
    },
    [bitmap]
  );
}

async function postCachedFrameIfAvailable(
  msg: DecodeFrameMessage,
  cacheKey: number
): Promise<boolean> {
  const cached = workerFrameCache.get(cacheKey);
  if (!cached) {
    return false;
  }

  try {
    // Clone the bitmap for transfer (original stays in cache)
    postDecodedFrame(msg, await createImageBitmap(cached));
    return true;
  } catch {
    // Cache entry invalid, remove it and decode fresh
    workerFrameCache.delete(cacheKey);
    return false;
  }
}

function evictOldestWorkerFrameIfNeeded(): void {
  if (workerFrameCache.size < WORKER_CACHE_SIZE) {
    return;
  }

  const firstKey = workerFrameCache.keys().next().value;
  if (firstKey === undefined) {
    return;
  }

  const evicted = workerFrameCache.get(firstKey);
  evicted?.close();
  workerFrameCache.delete(firstKey);
  postTypedMessage({ type: 'cache-evicted', timestampMs: firstKey });
}

async function cacheDecodedFrame(cacheKey: number, bitmap: ImageBitmap): Promise<void> {
  evictOldestWorkerFrameIfNeeded();
  workerFrameCache.set(cacheKey, await createImageBitmap(bitmap));
}

async function createBitmapFromSample(sample: {
  toVideoFrame: () => VideoFrame;
  close: () => void;
}): Promise<ImageBitmap | null> {
  if (isDisposed) {
    sample.close();
    return null;
  }

  const videoFrame = sample.toVideoFrame();
  try {
    return await createImageBitmap(videoFrame);
  } finally {
    videoFrame.close();
    sample.close();
  }
}

async function decodeFrame(msg: DecodeFrameMessage): Promise<void> {
  if (!sink) {
    postFrameError(msg, 'Decoder not initialized');
    return;
  }

  const cacheKey = Math.round(msg.timestampMs);
  if (await postCachedFrameIfAvailable(msg, cacheKey)) {
    return;
  }

  try {
    const sample = await sink.getSample(msg.timestampMs / 1000);
    if (!sample) {
      postFrameError(msg, 'No sample at timestamp');
      return;
    }

    const bitmap = await createBitmapFromSample(sample);
    if (!bitmap) {
      return;
    }

    await cacheDecodedFrame(cacheKey, bitmap);
    postDecodedFrame(msg, bitmap);
  } catch (err) {
    postFrameError(msg, err instanceof Error ? err.message : 'Decode failed');
  }
}

/**
 * Process decode queue with priority handling
 */
async function processQueue(): Promise<void> {
  if (isDecoding || pendingDecodes.size === 0) return;

  isDecoding = true;

  try {
    // Process immediate requests first, prioritizing the most recent scrub request.
    const immediate = [...pendingDecodes.values()]
      .filter((m) => m.priority === 'immediate')
      .sort((a, b) => b.requestId - a.requestId);

    const newestImmediate = immediate[0] ?? null;

    // Keep only the newest immediate request, drop stale scrub positions.
    for (const msg of immediate) {
      pendingDecodes.delete(msg.requestId);
      if (!newestImmediate || msg.requestId !== newestImmediate.requestId) {
        continue;
      }
      await decodeFrame(msg);
    }

    // Process prefetch only when there is no newer immediate request waiting.
    const prefetch = [...pendingDecodes.values()]
      .filter((m) => m.priority === 'prefetch')
      .sort((a, b) => b.requestId - a.requestId);

    for (const msg of prefetch) {
      pendingDecodes.delete(msg.requestId);
      if (msg.requestId < latestImmediateRequestId) {
        // Stale prefetch from an older scrub position.
        continue;
      }

      // New immediate work arrived while we were decoding; defer prefetch.
      const hasPendingImmediate = [...pendingDecodes.values()].some(
        (pending) => pending.priority === 'immediate'
      );
      if (hasPendingImmediate) {
        continue;
      }

      await decodeFrame(msg);
    }
  } finally {
    isDecoding = false;
  }

  // Continue if more requests came in
  if (pendingDecodes.size > 0) {
    processQueue();
  }
}

/**
 * Clear the worker-side frame cache
 */
function clearCache(): void {
  for (const bitmap of workerFrameCache.values()) {
    bitmap.close();
  }
  workerFrameCache.clear();
}

/**
 * Clean up all resources
 */
function dispose(): void {
  isDisposed = true; // Signal to abort any in-progress async init
  clearCache();
  pendingDecodes.clear();

  sink = null;
  videoTrack = null;

  if (input) {
    try {
      input.dispose();
    } catch {
      // Ignore dispose errors
    }
    input = null;
  }
}

// Message handler
self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;

  switch (msg.type) {
    case 'init':
      handleInit(msg.videoUrl, msg.maxCacheSize ?? 16 * 1024 * 1024);
      break;

    case 'decode-frame':
      if (msg.priority === 'immediate') {
        latestImmediateRequestId = Math.max(latestImmediateRequestId, msg.requestId);
        // Prefetch queued for older positions is stale once user scrubs to a new target.
        for (const [requestId, pending] of pendingDecodes.entries()) {
          if (pending.priority === 'prefetch') {
            pendingDecodes.delete(requestId);
          }
        }
      }
      pendingDecodes.set(msg.requestId, msg);
      processQueue();
      break;

    case 'clear-cache':
      clearCache();
      break;

    case 'dispose':
      dispose();
      break;
  }
};
