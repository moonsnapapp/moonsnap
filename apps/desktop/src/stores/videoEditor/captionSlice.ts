import { invoke } from '@tauri-apps/api/core';
import type { SliceCreator } from './types';
import type {
  CaptionData,
  CaptionSegment,
  CaptionSettings,
  WhisperModelInfo,
} from '../../types';
import { TIMING, TRANSCRIPTION } from '../../constants';
import { videoEditorLogger } from '../../utils/logger';

export function isTranscriptionCancelledError(error: unknown): boolean {
  return String(error).includes(TRANSCRIPTION.CANCELLED_MESSAGE);
}

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
  isCancellingTranscription: boolean;
  transcriptionProgress: number;
  transcriptionStage: string;
  transcriptionMessage: string;
  transcriptionError: string | null;

  // Model state
  whisperModels: WhisperModelInfo[];
  selectedModelName: string;
  selectedTranscriptionLanguage: string;
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
  cancelTranscription: () => Promise<void>;
  setTranscriptionProgress: (
    progress: number,
    stage: string,
    message?: string
  ) => void;
  setTranscriptionError: (error: string | null) => void;

  // Model actions
  loadWhisperModels: () => Promise<void>;
  setSelectedModel: (modelName: string) => void;
  setSelectedTranscriptionLanguage: (language: string) => void;
  setDownloadProgress: (progress: number) => void;
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
  isCancellingTranscription: false,
  transcriptionProgress: 0,
  transcriptionStage: '',
  transcriptionMessage: '',
  transcriptionError: null,

  // Initial model state
  whisperModels: [],
  selectedModelName: TRANSCRIPTION.DEFAULT_MODEL,
  selectedTranscriptionLanguage: TRANSCRIPTION.DEFAULT_LANGUAGE,
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
    const { selectedModelName, selectedTranscriptionLanguage } = get();

    set({
      isTranscribing: true,
      isCancellingTranscription: false,
      transcriptionProgress: 0,
      transcriptionStage: 'starting',
      transcriptionMessage: 'Starting transcription...',
      transcriptionError: null,
    });

    try {
      const result = await invoke<CaptionData>('transcribe_video', {
        videoPath,
        modelName: selectedModelName,
        language: selectedTranscriptionLanguage,
      });
      const currentSettings = get().captionSettings;

      set({
        captionSegments: result.segments,
        captionSettings: { ...currentSettings, enabled: true },
        isTranscribing: false,
        isCancellingTranscription: false,
        transcriptionProgress: 100,
        transcriptionStage: 'complete',
        transcriptionMessage: 'Transcription complete.',
      });
      scheduleCaptionSidecarSave(get);
    } catch (error) {
      const cancelled = isTranscriptionCancelledError(error);
      set({
        isTranscribing: false,
        isCancellingTranscription: false,
        transcriptionError: cancelled ? null : String(error),
        transcriptionStage: cancelled ? 'cancelled' : 'error',
        transcriptionMessage: cancelled
          ? TRANSCRIPTION.CANCELLED_MESSAGE
          : String(error),
        transcriptionProgress: cancelled ? 0 : get().transcriptionProgress,
      });
      throw error;
    }
  },

  transcribeCaptionSegment: async (
    videoPath,
    segmentStart,
    segmentEnd,
    language,
    modelName
  ) => {
    const {
      selectedModelName,
      whisperModels,
      downloadModel,
      selectedTranscriptionLanguage,
    } = get();
    const requestedModelName = modelName ?? selectedModelName;
    const requestedLanguage = language ?? selectedTranscriptionLanguage;
    const selectedModel = whisperModels.find(
      (model) => model.name === requestedModelName
    );

    if (!selectedModel?.downloaded) {
      await downloadModel(requestedModelName);
    }

    return await invoke<CaptionSegment>('transcribe_caption_segment', {
      videoPath,
      modelName: requestedModelName,
      language: requestedLanguage,
      segmentStart,
      segmentEnd,
    });
  },

  cancelTranscription: async () => {
    const { isCancellingTranscription } = get();
    if (isCancellingTranscription) {
      return;
    }

    set({
      isCancellingTranscription: true,
      transcriptionStage: 'cancelling',
      transcriptionMessage: 'Cancelling transcription...',
      transcriptionError: null,
    });

    try {
      await invoke('cancel_transcription');
    } catch (error) {
      videoEditorLogger.warn('Failed to request transcription cancellation:', error);
      set({
        isCancellingTranscription: false,
        transcriptionStage: 'error',
        transcriptionMessage: String(error),
        transcriptionError: String(error),
      });
      throw error;
    }
  },

  setTranscriptionProgress: (progress, stage, message) =>
    set((state) => ({
      transcriptionProgress: progress,
      transcriptionStage: stage,
      transcriptionMessage: message ?? '',
      isCancellingTranscription:
        state.isCancellingTranscription
          ? !['cancelled', 'complete', 'error'].includes(stage)
          : stage === 'cancelling',
      isTranscribing: [
        'starting',
        'loading_audio',
        'converting_audio',
        'extracting_audio',
        'transcribing',
        'cancelling',
      ].includes(stage),
    })),

  setTranscriptionError: (error) =>
    set({
      transcriptionError: error,
      isTranscribing: false,
      isCancellingTranscription: false,
      transcriptionMessage: error ?? '',
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

  setSelectedTranscriptionLanguage: (language) =>
    set({
      selectedTranscriptionLanguage: language,
    }),

  setDownloadProgress: (progress) =>
    set({
      downloadProgress: Math.max(0, Math.min(100, progress)),
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
        downloadProgress: 0,
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
