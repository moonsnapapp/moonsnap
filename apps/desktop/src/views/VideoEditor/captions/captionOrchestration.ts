import { useEffect, useState, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';

import { getEffectiveDuration } from '../../../stores/videoEditorStore';
import {
  selectProject,
  selectTimelineSegments,
} from '../../../stores/videoEditor/selectors';
import type {
  CaptionSegment,
  CaptionSettings,
  DownloadProgress,
  TranscriptionProgress,
  TrimSegment,
} from '../../../types';
import {
  clamp,
  cloneCaptionSegment,
} from '../../../utils/captionTiming';
import { remapCaptionSegmentToSource } from '../../../utils/captionTimeline';
import { videoEditorLogger } from '../../../utils/logger';
import type { SegmentAuditionState } from '../components/CaptionPanelWidgets';
import { parseCaptionEditWindow } from './captionEditTransforms';

const DEFAULT_VISIBLE_SEGMENTS = 20;
const CAPTION_PREVIEW_RENDER_WIDTH = 1920;
const CAPTION_PREVIEW_RENDER_HEIGHT = 1080;
const CAPTION_PREVIEW_CROP_HEIGHT = 260;
const CAPTION_PREVIEW_ZOOM = 1.7;
const CAPTION_PREVIEW_MAX_CROP_DISPLAY_HEIGHT = 220;

export function getCaptionErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function useCaptionPanelModelEffects({
  loadWhisperModels,
  whisperModels,
  regenerateModelName,
  selectedModelName,
  setRegenerateModelName,
  setTranscriptionProgress,
}: {
  loadWhisperModels: () => void;
  whisperModels: Array<{ name: string }>;
  regenerateModelName: string;
  selectedModelName: string;
  setRegenerateModelName: (modelName: string) => void;
  setTranscriptionProgress: (progress: number, stage: string) => void;
}) {
  useEffect(() => {
    loadWhisperModels();
  }, [loadWhisperModels]);

  useEffect(() => {
    if (!whisperModels.some((model) => model.name === regenerateModelName)) {
      setRegenerateModelName(selectedModelName);
    }
  }, [regenerateModelName, selectedModelName, setRegenerateModelName, whisperModels]);

  useEffect(() => {
    const unlistenTranscription = listen<TranscriptionProgress>(
      'transcription-progress',
      (event) => {
        setTranscriptionProgress(event.payload.progress, event.payload.stage);
      }
    );

    const unlistenDownload = listen<DownloadProgress>(
      'whisper-download-progress',
      (event) => {
        void event.payload;
      }
    );

    return () => {
      unlistenTranscription.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
    };
  }, [setTranscriptionProgress]);
}

export function getDownloadedModelState(models: Array<{ name: string; downloaded: boolean }>, modelName: string) {
  return models.find((model) => model.name === modelName)?.downloaded ?? false;
}

export function getVisibleCaptionSegments(
  showAllSegments: boolean,
  displayCaptionSegments: CaptionSegment[]
) {
  return showAllSegments
    ? displayCaptionSegments
    : displayCaptionSegments.slice(0, DEFAULT_VISIBLE_SEGMENTS);
}

export function getCaptionPreviewSourceSize(project: ReturnType<typeof selectProject>) {
  return {
    width: project?.sources.originalWidth ?? 1920,
    height: project?.sources.originalHeight ?? 1080,
  };
}

export function getCaptionEditDisplaySegment(
  displayCaptionSegmentsById: Map<string, CaptionSegment>,
  segment: CaptionSegment
) {
  return displayCaptionSegmentsById.get(segment.id) ?? segment;
}

export function addOriginalCaptionSegmentSnapshot(
  previous: Record<string, CaptionSegment>,
  segment: CaptionSegment
) {
  if (previous[segment.id]) return previous;
  return { ...previous, [segment.id]: cloneCaptionSegment(segment) };
}


export function getRegenerateEditingSegmentRequest({
  editingSegmentId,
  videoPath,
  editingText,
  editingStart,
  editingEnd,
  displayCaptionSegmentsById,
  timelineSegments,
}: {
  editingSegmentId: string | null;
  videoPath: string | null;
  editingText: string;
  editingStart: string;
  editingEnd: string;
  displayCaptionSegmentsById: Map<string, CaptionSegment>;
  timelineSegments: TrimSegment[] | undefined;
}) {
  const requestTarget = getRegenerateRequestTarget(editingSegmentId, videoPath);
  if (!requestTarget) return null;

  const editWindow = parseCaptionEditWindow(editingText, editingStart, editingEnd);
  if (!editWindow) return null;

  const timelineWindow: CaptionSegment = {
    id: requestTarget.editingSegmentId,
    start: editWindow.start,
    end: editWindow.end,
    text: '',
    words: [],
  };

  return {
    editingSegmentId: requestTarget.editingSegmentId,
    videoPath: requestTarget.videoPath,
    sourceWindow: displayCaptionSegmentsById.has(requestTarget.editingSegmentId)
      ? remapCaptionSegmentToSource(timelineWindow, timelineSegments)
      : timelineWindow,
  };
}

function getRegenerateRequestTarget(
  editingSegmentId: string | null,
  videoPath: string | null
) {
  return editingSegmentId && videoPath ? { editingSegmentId, videoPath } : null;
}

interface TranscribeRequest {
  videoPath: string | null;
  isModelDownloaded: boolean;
  selectedModelName: string;
  downloadModel: (modelName: string) => Promise<void>;
  startTranscription: (videoPath: string) => Promise<void>;
}

export async function transcribeWithDownloadedModel({
  videoPath,
  isModelDownloaded,
  selectedModelName,
  downloadModel,
  startTranscription,
}: TranscribeRequest) {
  if (!videoPath) return;

  const hasModel = await ensureTranscriptionModelDownloaded({
    isModelDownloaded,
    selectedModelName,
    downloadModel,
  });
  if (!hasModel) return;

  try {
    await startTranscription(videoPath);
  } catch (error) {
    videoEditorLogger.error('Transcription failed:', error);
  }
}

async function ensureTranscriptionModelDownloaded({
  isModelDownloaded,
  selectedModelName,
  downloadModel,
}: Pick<TranscribeRequest, 'isModelDownloaded' | 'selectedModelName' | 'downloadModel'>) {
  if (isModelDownloaded) return true;

  try {
    await downloadModel(selectedModelName);
    return true;
  } catch (error) {
    videoEditorLogger.error('Failed to download model:', error);
    return false;
  }
}

export function getInitialEditorSegment(
  editingSegmentId: string | null,
  displayCaptionSegments: CaptionSegment[],
  captionSegments: CaptionSegment[]
) {
  if (editingSegmentId) {
    return null;
  }

  const firstVisibleSegmentId = displayCaptionSegments[0]?.id;
  return getCaptionSegmentByOptionalId(captionSegments, firstVisibleSegmentId) ??
    getFirstCaptionSegment(captionSegments);
}

function getCaptionSegmentByOptionalId(
  captionSegments: CaptionSegment[],
  segmentId: string | undefined
) {
  return segmentId ? captionSegments.find((segment) => segment.id === segmentId) ?? null : null;
}

function getFirstCaptionSegment(captionSegments: CaptionSegment[]) {
  return captionSegments[0] ?? null;
}

interface SegmentAuditionTiming {
  rawSegment: CaptionSegment;
  state: SegmentAuditionState;
}

export function getSegmentAuditionTiming(
  segmentId: string,
  captionSegments: CaptionSegment[],
  displayCaptionSegmentsById: Map<string, CaptionSegment>
): SegmentAuditionTiming | null {
  const rawSegment = captionSegments.find((segment) => segment.id === segmentId);
  const timelineSegment = displayCaptionSegmentsById.get(segmentId);
  if (!rawSegment || !timelineSegment) {
    return null;
  }

  const startMs = Math.max(0, Math.floor(timelineSegment.start * 1000));
  return {
    rawSegment,
    state: {
      segmentId,
      startMs,
      endMs: Math.max(startMs + 1, Math.floor(timelineSegment.end * 1000)),
    },
  };
}

export function getSelectedEditingSegment(
  editingSegmentId: string | null,
  displayCaptionSegmentsById: Map<string, CaptionSegment>,
  captionSegments: CaptionSegment[]
) {
  if (!editingSegmentId) {
    return null;
  }

  return (
    displayCaptionSegmentsById.get(editingSegmentId) ??
    captionSegments.find((segment) => segment.id === editingSegmentId) ??
    null
  );
}

export function getProjectDurationSeconds(
  project: ReturnType<typeof selectProject>,
  timelineSegments: ReturnType<typeof selectTimelineSegments>,
  displayCaptionSegments: CaptionSegment[]
) {
  const timelineDurationMs = project
    ? getEffectiveDuration(timelineSegments ?? [], project.timeline.durationMs)
    : 0;
  const captionDurationSeconds = displayCaptionSegments.reduce(
    (max, segment) => Math.max(max, segment.end),
    0
  );

  return Math.max(timelineDurationMs / 1000, captionDurationSeconds, 1);
}

interface RegenerateDisabledInput {
  videoPath: string | null;
  editingSegmentId: string | null;
  captionSegments: CaptionSegment[];
  hasInvalidSegmentTiming: boolean;
  isRegeneratingSegment: boolean;
  isRegeneratingAllSegments: boolean;
}

function hasCaptionVideoPath(videoPath: string | null) {
  return Boolean(videoPath);
}

function isCaptionRegenerationBusy({
  isRegeneratingSegment,
  isRegeneratingAllSegments,
}: Pick<RegenerateDisabledInput, 'isRegeneratingSegment' | 'isRegeneratingAllSegments'>) {
  return isRegeneratingSegment || isRegeneratingAllSegments;
}

function canRegenerateCaptionSegment({
  videoPath,
  editingSegmentId,
  hasInvalidSegmentTiming,
  isBusy,
}: {
  videoPath: string | null;
  editingSegmentId: string | null;
  hasInvalidSegmentTiming: boolean;
  isBusy: boolean;
}) {
  return Boolean(videoPath && editingSegmentId && !hasInvalidSegmentTiming && !isBusy);
}

function canRegenerateAllCaptionSegments({
  videoPath,
  captionSegments,
  isBusy,
}: {
  videoPath: string | null;
  captionSegments: CaptionSegment[];
  isBusy: boolean;
}) {
  return hasCaptionVideoPath(videoPath) && captionSegments.length > 0 && !isBusy;
}

export function getRegenerateDisabledState({
  videoPath,
  editingSegmentId,
  captionSegments,
  hasInvalidSegmentTiming,
  isRegeneratingSegment,
  isRegeneratingAllSegments,
}: RegenerateDisabledInput) {
  const isBusy = isCaptionRegenerationBusy({
    isRegeneratingSegment,
    isRegeneratingAllSegments,
  });

  return {
    isRegenerateDisabled: !canRegenerateCaptionSegment({
      videoPath,
      editingSegmentId,
      hasInvalidSegmentTiming,
      isBusy,
    }),
    isRegenerateAllDisabled: !canRegenerateAllCaptionSegments({
      videoPath,
      captionSegments,
      isBusy,
    }),
  };
}

export function getCaptionPreviewLayout(
  displayWidth: number,
  position: CaptionSettings['position']
) {
  const scale =
    (displayWidth / CAPTION_PREVIEW_RENDER_WIDTH) *
    CAPTION_PREVIEW_ZOOM;
  const scaledWidth = Math.round(CAPTION_PREVIEW_RENDER_WIDTH * scale);
  const displayHeight = Math.round(CAPTION_PREVIEW_RENDER_HEIGHT * scale);
  const cropDisplayHeight = clamp(
    Math.round(CAPTION_PREVIEW_CROP_HEIGHT * scale),
    72,
    CAPTION_PREVIEW_MAX_CROP_DISPLAY_HEIGHT
  );
  const offsetX = Math.max(0, Math.round((scaledWidth - displayWidth) / 2));
  const cropOffsetY =
    position === 'top'
      ? 0
      : Math.max(0, displayHeight - cropDisplayHeight);

  return {
    scale,
    scaledWidth,
    displayHeight,
    cropDisplayHeight,
    offsetX,
    cropOffsetY,
  };
}

export function useObservedCaptionPreviewWidth(
  hostRef: RefObject<HTMLDivElement | null>,
  enabled: boolean
) {
  const [displayWidth, setDisplayWidth] = useState(720);

  useEffect(() => {
    if (!enabled) return;

    const host = hostRef.current;
    if (!host) return;

    const THROTTLE_MS = 100;
    let rafId: number | null = null;
    let trailingId: ReturnType<typeof setTimeout> | null = null;
    let lastFlushTime = 0;

    const updateWidth = () => {
      rafId = null;
      lastFlushTime = performance.now();
      const nextWidth = Math.floor(host.clientWidth);
      if (nextWidth > 0) {
        setDisplayWidth((prev) => (prev === nextWidth ? prev : nextWidth));
      }
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      if (rafId !== null || trailingId !== null) return;
      const elapsed = performance.now() - lastFlushTime;
      if (elapsed >= THROTTLE_MS) {
        rafId = requestAnimationFrame(updateWidth);
      } else {
        trailingId = setTimeout(() => {
          trailingId = null;
          rafId = requestAnimationFrame(updateWidth);
        }, THROTTLE_MS - elapsed);
      }
    });
    observer.observe(host);

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (trailingId !== null) clearTimeout(trailingId);
      observer.disconnect();
    };
  }, [enabled, hostRef]);

  return displayWidth;
}
