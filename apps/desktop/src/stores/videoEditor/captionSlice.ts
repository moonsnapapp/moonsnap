import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator } from './types';
import type {
  CaptionData,
  CaptionSegment,
  CaptionSettings,
  WhisperModelInfo,
} from '../../types';
import { TIMING } from '../../constants';
import { videoEditorLogger } from '../../utils/logger';

/**
 * Default caption settings
 */
export const DEFAULT_CAPTION_SETTINGS: CaptionSettings = {
  enabled: false,
  font: 'sans-serif',
  size: 32,
  fontWeight: 700,
  italic: false,
  color: '#FFFFFF',
  highlightColor: '#FFFF00',
  backgroundColor: '#000000',
  backgroundOpacity: 60,
  outline: false,
  outlineColor: '#000000',
  position: 'bottom',
  wordTransitionDuration: 0.25,
  fadeDuration: 0.15,
  lingerDuration: 0.4,
  exportWithSubtitles: false,
};

type CaptionPersistenceState = {
  project: { sources?: { screenVideo?: string } } | null;
  captionSegments: CaptionSegment[];
  captionSettings: CaptionSettings;
};

let captionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSavedCaptionSignature: string | null = null;

function buildCaptionSaveSignature(videoPath: string, data: CaptionData): string {
  return `${videoPath}:${JSON.stringify(data)}`;
}

function scheduleCaptionSidecarSave(get: () => CaptionPersistenceState): void {
  const { project, captionSegments, captionSettings } = get();
  const videoPath = project?.sources?.screenVideo;

  if (!videoPath) return;

  const data: CaptionData = {
    segments: captionSegments,
    settings: captionSettings,
  };
  const signature = buildCaptionSaveSignature(videoPath, data);

  if (signature === lastSavedCaptionSignature) return;

  if (captionSaveTimer) {
    clearTimeout(captionSaveTimer);
  }

  captionSaveTimer = setTimeout(() => {
    void invoke('save_caption_data', { videoPath, data })
      .then(() => {
        lastSavedCaptionSignature = signature;
      })
      .catch((error) => {
        videoEditorLogger.warn('Failed to persist caption sidecar:', error);
      });
  }, TIMING.CAPTION_AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Caption state and actions for managing transcription and captions
 */
export interface CaptionSlice {
  // Caption state
  captionSegments: CaptionSegment[];
  captionSettings: CaptionSettings;
  selectedCaptionSegmentId: string | null;

  // Transcription state
  isTranscribing: boolean;
  transcriptionProgress: number;
  transcriptionStage: string;
  transcriptionError: string | null;

  // Model state
  whisperModels: WhisperModelInfo[];
  selectedModelName: string;
  isDownloadingModel: boolean;
  downloadProgress: number;

  // Caption segment actions
  selectCaptionSegment: (id: string | null) => void;
  setCaptionSegments: (segments: CaptionSegment[]) => void;
  updateCaptionSegment: (id: string, updates: Partial<CaptionSegment>) => void;
  deleteCaptionSegment: (id: string) => void;
  clearCaptions: () => void;

  // Caption settings actions
  updateCaptionSettings: (updates: Partial<CaptionSettings>) => void;
  setCaptionsEnabled: (enabled: boolean) => void;

  // Transcription actions
  startTranscription: (videoPath: string) => Promise<void>;
  transcribeCaptionSegment: (
    videoPath: string,
    segmentStart: number,
    segmentEnd: number,
    language?: string,
    modelName?: string
  ) => Promise<CaptionSegment>;
  setTranscriptionProgress: (progress: number, stage: string) => void;
  setTranscriptionError: (error: string | null) => void;

  // Model actions
  loadWhisperModels: () => Promise<void>;
  setSelectedModel: (modelName: string) => void;
  downloadModel: (modelName: string) => Promise<void>;
  deleteModel: (modelName: string) => Promise<void>;

  // Persistence actions
  saveCaptions: (videoPath: string) => Promise<void>;
  loadCaptions: (videoPath: string) => Promise<void>;
}

export const createCaptionSlice: SliceCreator<CaptionSlice> = (set, get) => ({
  // Initial caption state
  captionSegments: [],
  captionSettings: DEFAULT_CAPTION_SETTINGS,
  selectedCaptionSegmentId: null,

  // Initial transcription state
  isTranscribing: false,
  transcriptionProgress: 0,
  transcriptionStage: '',
  transcriptionError: null,

  // Initial model state
  whisperModels: [],
  selectedModelName: 'base',
  isDownloadingModel: false,
  downloadProgress: 0,

  // Caption segment actions
  selectCaptionSegment: (id) =>
    set({
      selectedCaptionSegmentId: id,
    }),

  setCaptionSegments: (segments) =>
    {
      set({
        captionSegments: segments,
      });
      scheduleCaptionSidecarSave(get);
    },

  updateCaptionSegment: (id, updates) => {
    const { captionSegments } = get();
    set({
      captionSegments: captionSegments.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    });
    scheduleCaptionSidecarSave(get);
  },

  deleteCaptionSegment: (id) => {
    const { captionSegments, selectedCaptionSegmentId } = get();
    set({
      captionSegments: captionSegments.filter((s) => s.id !== id),
      selectedCaptionSegmentId:
        selectedCaptionSegmentId === id ? null : selectedCaptionSegmentId,
    });
    scheduleCaptionSidecarSave(get);
  },

  clearCaptions: () => {
    set({
      captionSegments: [],
      selectedCaptionSegmentId: null,
    });
    scheduleCaptionSidecarSave(get);
  },

  // Caption settings actions
  updateCaptionSettings: (updates) => {
    const { captionSettings } = get();
    set({
      captionSettings: { ...captionSettings, ...updates },
    });
    scheduleCaptionSidecarSave(get);
  },

  setCaptionsEnabled: (enabled) => {
    const { captionSettings } = get();
    set({
      captionSettings: { ...captionSettings, enabled },
    });
    scheduleCaptionSidecarSave(get);
  },

  // Transcription actions
  startTranscription: async (videoPath) => {
    const { selectedModelName } = get();

    set({
      isTranscribing: true,
      transcriptionProgress: 0,
      transcriptionStage: 'starting',
      transcriptionError: null,
    });

    try {
      const result = await invoke<CaptionData>('transcribe_video', {
        videoPath,
        modelName: selectedModelName,
        language: 'auto',
      });

      set({
        captionSegments: result.segments,
        captionSettings: { ...result.settings, enabled: true },
        isTranscribing: false,
        transcriptionProgress: 100,
        transcriptionStage: 'complete',
      });
      scheduleCaptionSidecarSave(get);
    } catch (error) {
      set({
        isTranscribing: false,
        transcriptionError: String(error),
        transcriptionStage: 'error',
      });
      throw error;
    }
  },

  transcribeCaptionSegment: async (
    videoPath,
    segmentStart,
    segmentEnd,
    language = 'auto',
    modelName
  ) => {
    const { selectedModelName, whisperModels, downloadModel } = get();
    const requestedModelName = modelName ?? selectedModelName;
    const selectedModel = whisperModels.find(
      (model) => model.name === requestedModelName
    );

    if (!selectedModel?.downloaded) {
      await downloadModel(requestedModelName);
    }

    return await invoke<CaptionSegment>('transcribe_caption_segment', {
      videoPath,
      modelName: requestedModelName,
      language,
      segmentStart,
      segmentEnd,
    });
  },

  setTranscriptionProgress: (progress, stage) =>
    set({
      transcriptionProgress: progress,
      transcriptionStage: stage,
    }),

  setTranscriptionError: (error) =>
    set({
      transcriptionError: error,
      isTranscribing: false,
    }),

  // Model actions
  loadWhisperModels: async () => {
    try {
      const models = await invoke<WhisperModelInfo[]>('list_whisper_models');
      set({ whisperModels: models });
    } catch (error) {
      videoEditorLogger.error('Failed to load Whisper models:', error);
    }
  },

  setSelectedModel: (modelName) =>
    set({
      selectedModelName: modelName,
    }),

  downloadModel: async (modelName) => {
    set({
      isDownloadingModel: true,
      downloadProgress: 0,
    });

    try {
      await invoke<string>('download_whisper_model', { modelName });

      // Refresh model list
      const models = await invoke<WhisperModelInfo[]>('list_whisper_models');
      set({
        whisperModels: models,
        isDownloadingModel: false,
        downloadProgress: 100,
      });
    } catch (error) {
      set({
        isDownloadingModel: false,
      });
      throw error;
    }
  },

  deleteModel: async (modelName) => {
    try {
      await invoke('delete_whisper_model', { modelName });

      // Refresh model list
      const models = await invoke<WhisperModelInfo[]>('list_whisper_models');
      set({ whisperModels: models });
    } catch (error) {
      videoEditorLogger.error('Failed to delete model:', error);
      throw error;
    }
  },

  // Persistence actions
  saveCaptions: async (videoPath) => {
    const { captionSegments, captionSettings } = get();

    const data: CaptionData = {
      segments: captionSegments,
      settings: captionSettings,
    };

    await invoke('save_caption_data', { videoPath, data });
    lastSavedCaptionSignature = buildCaptionSaveSignature(videoPath, data);
  },

  loadCaptions: async (videoPath) => {
    try {
      const data = await invoke<CaptionData | null>('load_caption_data', {
        videoPath,
      });

      if (data) {
        set({
          captionSegments: data.segments,
          captionSettings: data.settings,
        });
        lastSavedCaptionSignature = buildCaptionSaveSignature(videoPath, data);
      }
    } catch (error) {
      videoEditorLogger.error('Failed to load captions:', error);
    }
  },
});
