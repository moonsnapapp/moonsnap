import { memo, useEffect, useRef, useState, useMemo } from 'react';
import { Volume2 } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { WAVEFORM } from '../../constants';
import { audioLogger } from '../../utils/logger';
import type { AudioWaveform } from '../../types';

interface AudioTrackProps {
  /** Path to audio/video file to extract waveform from */
  audioPath?: string;
  /** Duration of the timeline in milliseconds */
  durationMs: number;
  /** Timeline zoom level (pixels per millisecond) */
  timelineZoom: number;
}

// Maximum samples for performance (like Cap's approach)
const MAX_WAVEFORM_SAMPLES = 6000;

// dB range for scaling (-60dB to -30dB like Cap)
const DB_MIN = -60;
const DB_MAX = -30;
const WAVEFORM_BOTTOM_PADDING_PX = 2;
const WAVEFORM_TOP_PADDING_PX = 2;
const WAVEFORM_RESPONSE_GAMMA = 0.72;
const WAVEFORM_MIN_VISIBLE_HEIGHT = 0.06;

/**
 * Convert linear amplitude to dB scale and normalize to 0-1 range
 */
function linearToDbNormalized(sample: number): number {
  // Avoid log of zero
  const amplitude = Math.abs(sample) + 1e-10;
  // Convert to dB
  const db = 20 * Math.log10(amplitude);
  // Normalize to 0-1 range using -60dB to -30dB scale
  return Math.max(0, Math.min(1, (db - DB_MIN) / (DB_MAX - DB_MIN)));
}

function shapeWaveformLevel(level: number): number {
  if (level <= 0) {
    return 0;
  }

  const curved = Math.pow(level, WAVEFORM_RESPONSE_GAMMA);
  return WAVEFORM_MIN_VISIBLE_HEIGHT + curved * (1 - WAVEFORM_MIN_VISIBLE_HEIGHT);
}

function getWaveformSampleChunkBounds(index: number, ratio: number) {
  return {
    start: Math.floor(index * ratio),
    end: Math.floor((index + 1) * ratio),
  };
}

function getWaveformChunkMax(samples: number[], start: number, end: number): number {
  let max = 0;

  for (let index = start; index < end && index < samples.length; index++) {
    max = Math.max(max, Math.abs(samples[index]));
  }

  return max;
}

/**
 * Downsample waveform data to target number of samples
 */
function downsampleWaveform(samples: number[], targetSamples: number): number[] {
  if (samples.length <= targetSamples) {
    return samples;
  }

  const ratio = samples.length / targetSamples;
  const downsampled: number[] = [];

  for (let i = 0; i < targetSamples; i++) {
    const { start, end } = getWaveformSampleChunkBounds(i, ratio);
    downsampled.push(getWaveformChunkMax(samples, start, end));
  }

  return downsampled;
}

function processWaveformSamples(waveform: AudioWaveform | null) {
  if (!waveform || waveform.samples.length === 0) return null;

  const samples = waveform.samples.length > MAX_WAVEFORM_SAMPLES
    ? downsampleWaveform(waveform.samples, MAX_WAVEFORM_SAMPLES)
    : waveform.samples;

  return samples.map((sample) => shapeWaveformLevel(linearToDbNormalized(sample)));
}

async function fetchAudioWaveform(audioPath: string) {
  // Shared waveform extraction density for timeline consistency.
  return invoke<AudioWaveform>('extract_audio_waveform', {
    audioPath,
    samplesPerSecond: WAVEFORM.DEFAULT_SAMPLES_PER_SECOND,
  });
}

function getAudioWaveformErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function applyLoadedWaveform(
  data: AudioWaveform,
  cancelled: boolean,
  setWaveform: React.Dispatch<React.SetStateAction<AudioWaveform | null>>
) {
  if (!cancelled) {
    setWaveform(data);
  }
}

function applyWaveformLoadError(
  error: unknown,
  cancelled: boolean,
  setError: React.Dispatch<React.SetStateAction<string | null>>
) {
  if (cancelled) return;

  setError(getAudioWaveformErrorMessage(error));
  audioLogger.error('Failed to load waveform:', error);
}

function finishWaveformLoad(
  cancelled: boolean,
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>
) {
  if (!cancelled) {
    setIsLoading(false);
  }
}

function useAudioWaveform(audioPath: string | undefined) {
  const [waveform, setWaveform] = useState<AudioWaveform | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!audioPath) return;

    const waveformPath = audioPath;
    let cancelled = false;

    async function loadWaveform() {
      setIsLoading(true);
      setError(null);

      try {
        applyLoadedWaveform(await fetchAudioWaveform(waveformPath), cancelled, setWaveform);
      } catch (err) {
        applyWaveformLoadError(err, cancelled, setError);
      } finally {
        finishWaveformLoad(cancelled, setIsLoading);
      }
    }

    loadWaveform();

    return () => {
      cancelled = true;
    };
  }, [audioPath]);

  const processedSamples = useMemo(() => {
    return processWaveformSamples(waveform);
  }, [waveform]);

  return { waveform, processedSamples, isLoading, error };
}

function drawProcessedWaveform(
  canvas: HTMLCanvasElement,
  processedSamples: number[],
  totalWidth: number
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const height = canvas.height;
  const baselineY = height - WAVEFORM_BOTTOM_PADDING_PX;
  canvas.width = totalWidth;
  ctx.clearRect(0, 0, canvas.width, height);

  const samplesCount = processedSamples.length;
  const sampleWidth = totalWidth / samplesCount;
  const maxAmplitude = Math.max(1, height - WAVEFORM_TOP_PADDING_PX - WAVEFORM_BOTTOM_PADDING_PX);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, 'rgba(200, 204, 211, 0.85)');
  gradient.addColorStop(0.6, 'rgba(156, 163, 175, 0.6)');
  gradient.addColorStop(1, 'rgba(107, 114, 128, 0.25)');

  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(0, baselineY);

  for (let i = 0; i < samplesCount; i++) {
    const x = i * sampleWidth;
    const amplitude = processedSamples[i] * maxAmplitude;
    ctx.lineTo(x, baselineY - amplitude);
  }

  ctx.lineTo(totalWidth, baselineY);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(156, 163, 175, 0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, baselineY + 0.5);
  ctx.lineTo(totalWidth, baselineY + 0.5);
  ctx.stroke();
}

function WaveformCanvas({
  processedSamples,
  totalWidth,
}: {
  processedSamples: number[];
  totalWidth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !processedSamples || processedSamples.length === 0) return;
    drawProcessedWaveform(canvas, processedSamples, totalWidth);
  }, [processedSamples, totalWidth]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ width: totalWidth, height: '100%' }}
      height={32}
    />
  );
}

function AudioTrackStatus({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'error' }) {
  const colorClass = tone === 'error' ? 'text-red-400' : 'text-zinc-500';
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <span className={`text-xs ${colorClass}`}>{children}</span>
    </div>
  );
}

type AudioTrackContentState =
  | { type: 'loading' }
  | { type: 'error' }
  | { type: 'empty' }
  | { type: 'waveform'; processedSamples: number[] };

function isAudioTrackContentEmpty(
  waveform: AudioWaveform | null,
  processedSamples: number[] | null,
) {
  return waveform === null || processedSamples === null;
}

function getAudioTrackContentState({
  waveform,
  processedSamples,
  isLoading,
  error,
}: {
  waveform: AudioWaveform | null;
  processedSamples: number[] | null;
  isLoading: boolean;
  error: string | null;
}): AudioTrackContentState {
  const statusState = [
    { matches: isLoading, state: { type: 'loading' } as const },
    { matches: error !== null, state: { type: 'error' } as const },
    {
      matches: isAudioTrackContentEmpty(waveform, processedSamples),
      state: { type: 'empty' } as const,
    },
  ].find(({ matches }) => matches)?.state;

  return statusState ?? { type: 'waveform', processedSamples: processedSamples ?? [] };
}

function renderAudioTrackContentState(state: AudioTrackContentState, totalWidth: number) {
  const renderers: Record<AudioTrackContentState['type'], () => React.ReactNode> = {
    loading: () => <AudioTrackStatus>Loading waveform...</AudioTrackStatus>,
    error: () => <AudioTrackStatus tone="error">Failed to load audio</AudioTrackStatus>,
    empty: () => <AudioTrackStatus>No audio</AudioTrackStatus>,
    waveform: () => (
      <WaveformCanvas
        processedSamples={state.type === 'waveform' ? state.processedSamples : []}
        totalWidth={totalWidth}
      />
    ),
  };

  return renderers[state.type]();
}

function AudioTrackContent({
  waveform,
  processedSamples,
  isLoading,
  error,
  totalWidth,
}: {
  waveform: AudioWaveform | null;
  processedSamples: number[] | null;
  isLoading: boolean;
  error: string | null;
  totalWidth: number;
}) {
  const state = getAudioTrackContentState({
    waveform,
    processedSamples,
    isLoading,
    error,
  });

  return renderAudioTrackContentState(state, totalWidth);
}

/**
 * AudioTrack component displays an audio waveform visualization.
 *
 * Fetches waveform data from the Rust backend and renders it
 * as a canvas-based visualization that responds to timeline zoom.
 */
export const AudioTrack = memo(function AudioTrack({
  audioPath,
  durationMs,
  timelineZoom,
}: AudioTrackProps) {
  const { waveform, processedSamples, isLoading, error } = useAudioWaveform(audioPath);

  const totalWidth = durationMs * timelineZoom;

  return (
    <div className="h-full flex items-stretch">
      {/* Track Label */}
      <div className="flex-shrink-0 w-[100px] bg-zinc-900 border-r border-zinc-800 flex items-center gap-2 px-3">
        <Volume2 className="h-3.5 w-3.5 text-zinc-500" />
        <span className="text-xs text-zinc-400">Audio</span>
      </div>

      {/* Waveform Canvas */}
      <div
        className="flex-1 relative bg-zinc-900/50 overflow-hidden"
        style={{ width: totalWidth }}
      >
        <AudioTrackContent
          waveform={waveform}
          processedSamples={processedSamples}
          isLoading={isLoading}
          error={error}
          totalWidth={totalWidth}
        />
      </div>
    </div>
  );
});
