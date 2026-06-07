import React, { useEffect, useRef, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { editorLogger } from '@/utils/logger';
import type { GifInfo } from '@/types/generated/GifInfo';
import { newRowId } from './frameOps';
import type { FrameRow, GifData, UiState } from './types';

interface GifLoaderParams {
  /** Path from props (embedded), or undefined to read from `?path=`. */
  pathProp?: string;
  setRows: React.Dispatch<React.SetStateAction<FrameRow[]>>;
  setUi: React.Dispatch<React.SetStateAction<UiState>>;
}

interface GifLoaderResult {
  isLoading: boolean;
  error: string | null;
  capturePath: string | null;
  info: GifInfo | null;
  gifData: GifData | null;
}

interface LoadedGifResult {
  info: GifInfo;
  gifData: GifData;
  rows: FrameRow[];
}

function getGifPath(pathProp: string | undefined): string | null {
  return pathProp ?? getGifPathFromQuery();
}

function getGifPathFromQuery(): string | null {
  const encodedPath = new URLSearchParams(window.location.search).get('path');
  return encodedPath ? decodeURIComponent(encodedPath) : null;
}

async function loadGifData(path: string): Promise<LoadedGifResult> {
  editorLogger.info('Loading GIF:', path);

  // Probe via Rust just for file size (and a sanity check that ffprobe
  // can read it before the user hits Export).
  const info = await invoke<GifInfo>('get_gif_info', { path });
  const response = await fetch(convertFileSrc(path));
  const buf = await response.arrayBuffer();
  const parsed = parseGIF(buf);
  const frames = decompressFrames(parsed, true);
  const gifData: GifData = {
    width: parsed.lsd.width,
    height: parsed.lsd.height,
    frames,
  };

  return {
    info,
    gifData,
    rows: getInitialFrameRows(frames),
  };
}

function getInitialFrameRows(frames: GifData['frames']): FrameRow[] {
  return frames.map((frame, index) => ({
    id: newRowId(index),
    sourceIndex: index,
    delayMs: getFrameDelayMs(frame.delay),
    originalDelayMs: getFrameDelayMs(frame.delay),
  }));
}

function getFrameDelayMs(delay: number) {
  return delay > 0 ? delay : 100;
}

function applyLoadedGifResult({
  result,
  setInfo,
  setGifData,
  setRows,
  setUi,
}: {
  result: LoadedGifResult;
  setInfo: React.Dispatch<React.SetStateAction<GifInfo | null>>;
  setGifData: React.Dispatch<React.SetStateAction<GifData | null>>;
  setRows: React.Dispatch<React.SetStateAction<FrameRow[]>>;
  setUi: React.Dispatch<React.SetStateAction<UiState>>;
}) {
  setInfo(result.info);
  setGifData(result.gifData);
  setUi((prev) => ({
    ...prev,
    outputWidth: result.gifData.width,
    outputHeight: result.gifData.height,
  }));
  setRows(result.rows);
}

function getLoadGifErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Resolve the GIF path (prop or `?path=` query param), probe it via Rust for
 * metadata, then parse + decode it entirely in the browser with gifuct-js.
 * Seeds the initial frame rows and output dimensions through the provided
 * setters. Runs once per mount — EmbeddedGifEditor keys the component by path,
 * so a path change always remounts and re-fires.
 */
export function useGifLoader({
  pathProp,
  setRows,
  setUi,
}: GifLoaderParams): GifLoaderResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [capturePath, setCapturePath] = useState<string | null>(null);
  const [info, setInfo] = useState<GifInfo | null>(null);
  const [gifData, setGifData] = useState<GifData | null>(null);
  const hasLoadedRef = useRef(false);

  useEffect(() => {
    if (hasLoadedRef.current) return;
    const path = getGifPath(pathProp);
    if (!path) {
      setError('No GIF path provided');
      setIsLoading(false);
      return;
    }
    hasLoadedRef.current = true;
    setCapturePath(path);

    (async () => {
      try {
        const result = await loadGifData(path);
        applyLoadedGifResult({ result, setInfo, setGifData, setRows, setUi });
        setIsLoading(false);
      } catch (err) {
        editorLogger.error('Failed to load GIF:', err);
        setError(getLoadGifErrorMessage(err));
        setIsLoading(false);
      }
    })();
  }, [pathProp, setRows, setUi]);

  return { isLoading, error, capturePath, info, gifData };
}
