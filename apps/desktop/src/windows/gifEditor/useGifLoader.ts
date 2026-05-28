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
    let path = pathProp;
    if (!path) {
      const urlParams = new URLSearchParams(window.location.search);
      const encodedPath = urlParams.get('path');
      if (encodedPath) {
        path = decodeURIComponent(encodedPath);
      }
    }
    if (!path) {
      setError('No GIF path provided');
      setIsLoading(false);
      return;
    }
    hasLoadedRef.current = true;
    setCapturePath(path);

    (async () => {
      try {
        editorLogger.info('Loading GIF:', path);

        // Probe via Rust just for file size (and a sanity check that ffprobe
        // can read it before the user hits Export).
        const probed = await invoke<GifInfo>('get_gif_info', { path });
        setInfo(probed);

        const response = await fetch(convertFileSrc(path));
        const buf = await response.arrayBuffer();
        const parsed = parseGIF(buf);
        const frames = decompressFrames(parsed, true);

        const data: GifData = {
          width: parsed.lsd.width,
          height: parsed.lsd.height,
          frames,
        };
        setGifData(data);
        setUi((prev) => ({
          ...prev,
          outputWidth: parsed.lsd.width,
          outputHeight: parsed.lsd.height,
        }));

        const initialRows: FrameRow[] = frames.map((f, i) => ({
          id: newRowId(i),
          sourceIndex: i,
          delayMs: f.delay > 0 ? f.delay : 100,
          originalDelayMs: f.delay > 0 ? f.delay : 100,
        }));
        setRows(initialRows);
        setIsLoading(false);
      } catch (err) {
        editorLogger.error('Failed to load GIF:', err);
        setError(err instanceof Error ? err.message : String(err));
        setIsLoading(false);
      }
    })();
  }, [pathProp, setRows, setUi]);

  return { isLoading, error, capturePath, info, gifData };
}
