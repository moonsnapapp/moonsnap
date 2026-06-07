/**
 * useWebCodecsPreview - WebCodecs-based video frame decoder for instant scrubbing.
 *
 * Uses a Web Worker for hardware-accelerated frame decoding via WebCodecs.
 * Decoding happens off the main thread to prevent UI blocking during scrubbing.
 * Maintains a cache of decoded frames for instant preview.
 *
 * Benefits over video element seeking:
 * - Off-main-thread decoding via Web Worker
 * - No seeking latency - frames are pre-decoded and cached
 * - Hardware acceleration via WebCodecs
 * - Zero-copy frame transfer via ImageBitmap
 */

import { useEffect, useRef, useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useWebCodecsWorker } from './useWebCodecsWorker';
import { videoEditorLogger } from '@/utils/logger';
import type { FrameDecodedMessage } from '../workers/webcodecs-decoder.types';

interface FrameCache {
  [timestampMs: number]: ImageBitmap;
}

type FrameRequestPriority = 'immediate' | 'prefetch';
type RequestVideoFrame = (
  timestampMs: number,
  priority: FrameRequestPriority,
) => number;

// How many frames to keep in cache
const MAX_CACHE_SIZE = 30;
// How far ahead to pre-decode (ms)
const PREFETCH_RANGE_MS = 500;
// Interval between pre-decoded frames (ms)
const PREFETCH_INTERVAL_MS = 250;
// Throttle interval for prefetch calls (ms)
const PREFETCH_THROTTLE_MS = 200;
// Fast scrubbing detection: if position changes more than this in PREFETCH_THROTTLE_MS, skip prefetch
const FAST_SCRUB_DISTANCE_MS = 500;

export interface WebCodecsPreviewResult {
  /** Get a frame at the given timestamp. Returns null if not yet decoded. */
  getFrame: (timestampMs: number) => ImageBitmap | null;
  /** Request frames to be decoded around a timestamp */
  prefetchAround: (timestampMs: number) => void;
  /** Whether the decoder is ready */
  isReady: boolean;
  /** Any error that occurred */
  error: string | null;
  /** Video dimensions */
  dimensions: { width: number; height: number } | null;
}

function shouldSkipPrefetchForFastScrub(timestampMs: number, lastPositionMs: number) {
  return (
    lastPositionMs > 0 &&
    Math.abs(timestampMs - lastPositionMs) > FAST_SCRUB_DISTANCE_MS
  );
}

function requestFrameIfNeeded({
  timestampMs,
  priority,
  frameCache,
  pendingTimestamps,
  pendingRequestsById,
  requestFrame,
}: {
  timestampMs: number;
  priority: FrameRequestPriority;
  frameCache: FrameCache;
  pendingTimestamps: Set<number>;
  pendingRequestsById: Map<number, number>;
  requestFrame: RequestVideoFrame;
}) {
  const rounded = Math.round(timestampMs);
  if (frameCache[rounded] || pendingTimestamps.has(rounded)) return;

  const requestId = requestFrame(timestampMs, priority);
  if (requestId < 0) return;
  pendingRequestsById.set(requestId, rounded);
  pendingTimestamps.add(rounded);
}

function requestPrefetchRange({
  timestampMs,
  durationMs,
  frameCache,
  pendingTimestamps,
  pendingRequestsById,
  requestFrame,
}: {
  timestampMs: number;
  durationMs: number;
  frameCache: FrameCache;
  pendingTimestamps: Set<number>;
  pendingRequestsById: Map<number, number>;
  requestFrame: RequestVideoFrame;
}) {
  for (
    let offset = PREFETCH_INTERVAL_MS;
    offset <= PREFETCH_RANGE_MS;
    offset += PREFETCH_INTERVAL_MS
  ) {
    const before = Math.round(timestampMs - offset);
    const after = Math.round(timestampMs + offset);

    if (before >= 0) {
      requestFrameIfNeeded({
        timestampMs: before,
        priority: 'prefetch',
        frameCache,
        pendingTimestamps,
        pendingRequestsById,
        requestFrame,
      });
    }
    if (after <= durationMs) {
      requestFrameIfNeeded({
        timestampMs: after,
        priority: 'prefetch',
        frameCache,
        pendingTimestamps,
        pendingRequestsById,
        requestFrame,
      });
    }
  }
}

/**
 * Hook for WebCodecs-based video preview.
 * Provides instant frame access by pre-decoding frames around the cursor.
 * Uses Web Worker for off-main-thread decoding.
 */
export function useWebCodecsPreview(videoPath: string | null): WebCodecsPreviewResult {
  const frameCache = useRef<FrameCache>({});
  // Track pending decodes by both request id and timestamp to avoid duplicate requests.
  const pendingRequestsById = useRef<Map<number, number>>(new Map());
  const pendingTimestamps = useRef<Set<number>>(new Set());
  const lastPrefetchTimeRef = useRef<number>(0);
  const lastPrefetchPositionRef = useRef<number>(0);
  const lastReceivedTimestampRef = useRef<number>(0);

  // Convert file path to URL for worker
  const videoUrl = videoPath ? convertFileSrc(videoPath) : null;

  // Handle frame received from worker - receives ownership of transferred ImageBitmap
  const handleFrameDecoded = useCallback((msg: FrameDecodedMessage) => {
    const cacheKey = Math.round(msg.timestampMs);
    const pendingTs = pendingRequestsById.current.get(msg.requestId);
    if (pendingTs !== undefined) {
      pendingRequestsById.current.delete(msg.requestId);
      pendingTimestamps.current.delete(pendingTs);
    }
    lastReceivedTimestampRef.current = msg.timestampMs;

    // Store in cache - we now own this ImageBitmap
    frameCache.current[cacheKey] = msg.bitmap;

    // Evict old frames if cache is full (LRU based on distance from current position)
    const keys = Object.keys(frameCache.current).map(Number);
    if (keys.length > MAX_CACHE_SIZE) {
      keys.sort(
        (a, b) => Math.abs(a - msg.timestampMs) - Math.abs(b - msg.timestampMs)
      );
      const toRemove = keys.slice(MAX_CACHE_SIZE);
      for (const ts of toRemove) {
        frameCache.current[ts]?.close();
        delete frameCache.current[ts];
      }
    }
  }, []);

  // Handle frame decode error
  const handleFrameError = useCallback(
    (requestId: number, _timestampMs: number, error: string) => {
      const pendingTs = pendingRequestsById.current.get(requestId);
      if (pendingTs !== undefined) {
        pendingRequestsById.current.delete(requestId);
        pendingTimestamps.current.delete(pendingTs);
      }
      // Only log unexpected errors, not "no sample" which is normal at boundaries
      if (!error.includes('No sample') && !error.includes('disposed')) {
        videoEditorLogger.warn('[WebCodecsPreview] Frame error:', error);
      }
    },
    []
  );

  // Handle cache eviction notification from worker (informational only)
  const handleCacheEvicted = useCallback((_timestampMs: number) => {
    // Worker evicted from its small cache - no action needed on main thread
  }, []);

  // Use worker hook for off-main-thread decoding
  const worker = useWebCodecsWorker(videoUrl, {
    onFrameDecoded: handleFrameDecoded,
    onFrameError: handleFrameError,
    onCacheEvicted: handleCacheEvicted,
  });

  // Clean up frame cache when video changes or on unmount
  useEffect(() => {
    const currentFrameCache = frameCache.current;
    const currentPendingRequestsById = pendingRequestsById.current;
    const currentPendingTimestamps = pendingTimestamps.current;

    return () => {
      for (const bitmap of Object.values(currentFrameCache)) {
        bitmap.close();
      }
      if (frameCache.current === currentFrameCache) {
        frameCache.current = {};
      }
      currentPendingRequestsById.clear();
      currentPendingTimestamps.clear();
    };
  }, [videoUrl]);

  // Get frame from cache
  const getFrame = useCallback((timestampMs: number): ImageBitmap | null => {
    const rounded = Math.round(timestampMs);
    const exact = frameCache.current[rounded];
    if (exact) return exact;

    // Find nearest within 250ms tolerance
    const keys = Object.keys(frameCache.current).map(Number);
    let nearest: number | null = null;
    let nearestDist = Infinity;

    for (const ts of keys) {
      const dist = Math.abs(ts - timestampMs);
      if (dist < nearestDist && dist < 250) {
        nearestDist = dist;
        nearest = ts;
      }
    }

    return nearest !== null ? frameCache.current[nearest] : null;
  }, []);

  // Prefetch frames around a timestamp (throttled, with fast-scrub detection)
  const prefetchAround = useCallback(
    (timestampMs: number) => {
      if (!worker.isReady) return;

      const now = Date.now();
      const timeSinceLastPrefetch = now - lastPrefetchTimeRef.current;
      if (timeSinceLastPrefetch < PREFETCH_THROTTLE_MS) return;

      if (shouldSkipPrefetchForFastScrub(timestampMs, lastPrefetchPositionRef.current)) {
        lastPrefetchTimeRef.current = now;
        lastPrefetchPositionRef.current = timestampMs;
        pendingRequestsById.current.clear();
        pendingTimestamps.current.clear();
        worker.clearCache();
        return;
      }

      lastPrefetchTimeRef.current = now;
      lastPrefetchPositionRef.current = timestampMs;

      const requestFrame = worker.requestFrame;
      requestFrameIfNeeded({
        timestampMs,
        priority: 'immediate',
        frameCache: frameCache.current,
        pendingTimestamps: pendingTimestamps.current,
        pendingRequestsById: pendingRequestsById.current,
        requestFrame,
      });
      requestPrefetchRange({
        timestampMs,
        durationMs: worker.durationMs,
        frameCache: frameCache.current,
        pendingTimestamps: pendingTimestamps.current,
        pendingRequestsById: pendingRequestsById.current,
        requestFrame,
      });
    },
    [worker]
  );

  return {
    getFrame,
    prefetchAround,
    isReady: worker.isReady,
    error: worker.error,
    dimensions: worker.dimensions,
  };
}
