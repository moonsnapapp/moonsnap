import { useVideoEditorStore } from '../../../stores/videoEditorStore';
import {
  selectCaptionSegments,
  selectCaptionSettings,
  selectClearCaptions,
  selectDownloadModel,
  selectDownloadProgress,
  selectIsDownloadingModel,
  selectIsTranscribing,
  selectLoadWhisperModels,
  selectProject,
  selectRequestSeek,
  selectSelectedModelName,
  selectSelectedTranscriptionLanguage,
  selectSetCaptionSegments,
  selectSetCaptionsEnabled,
  selectSetIsPlaying,
  selectSetSelectedModel,
  selectSetSelectedTranscriptionLanguage,
  selectSetTranscriptionProgress,
  selectStartTranscription,
  selectTogglePlayback,
  selectTimelineSegments,
  selectTranscribeCaptionSegment,
  selectTranscriptionError,
  selectTranscriptionProgress,
  selectTranscriptionStage,
  selectUpdateCaptionSegment,
  selectUpdateCaptionSettings,
  selectWhisperModels,
} from '../../../stores/videoEditor/selectors';

export function useCaptionPanelStoreState() {
  const project = useVideoEditorStore(selectProject);
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const clearCaptions = useVideoEditorStore(selectClearCaptions);
  const timelineSegments = useVideoEditorStore(selectTimelineSegments);
  const isTranscribing = useVideoEditorStore(selectIsTranscribing);
  const transcriptionProgress = useVideoEditorStore(selectTranscriptionProgress);
  const transcriptionStage = useVideoEditorStore(selectTranscriptionStage);
  const transcriptionError = useVideoEditorStore(selectTranscriptionError);
  const whisperModels = useVideoEditorStore(selectWhisperModels);
  const selectedModelName = useVideoEditorStore(selectSelectedModelName);
  const selectedTranscriptionLanguage = useVideoEditorStore(
    selectSelectedTranscriptionLanguage
  );
  const isDownloadingModel = useVideoEditorStore(selectIsDownloadingModel);
  const downloadProgress = useVideoEditorStore(selectDownloadProgress);
  const loadWhisperModels = useVideoEditorStore(selectLoadWhisperModels);
  const setSelectedModel = useVideoEditorStore(selectSetSelectedModel);
  const setSelectedTranscriptionLanguage = useVideoEditorStore(
    selectSetSelectedTranscriptionLanguage
  );
  const downloadModel = useVideoEditorStore(selectDownloadModel);
  const startTranscription = useVideoEditorStore(selectStartTranscription);
  const transcribeCaptionSegment = useVideoEditorStore(selectTranscribeCaptionSegment);
  const updateCaptionSettings = useVideoEditorStore(selectUpdateCaptionSettings);
  const updateCaptionSegment = useVideoEditorStore(selectUpdateCaptionSegment);
  const setCaptionSegments = useVideoEditorStore(selectSetCaptionSegments);
  const setCaptionsEnabled = useVideoEditorStore(selectSetCaptionsEnabled);
  const setTranscriptionProgress = useVideoEditorStore(selectSetTranscriptionProgress);
  const requestSeek = useVideoEditorStore(selectRequestSeek);
  const setIsPlaying = useVideoEditorStore(selectSetIsPlaying);
  const togglePlayback = useVideoEditorStore(selectTogglePlayback);

  return {
    project,
    captionSegments,
    captionSettings,
    clearCaptions,
    timelineSegments,
    isTranscribing,
    transcriptionProgress,
    transcriptionStage,
    transcriptionError,
    whisperModels,
    selectedModelName,
    selectedTranscriptionLanguage,
    isDownloadingModel,
    downloadProgress,
    loadWhisperModels,
    setSelectedModel,
    setSelectedTranscriptionLanguage,
    downloadModel,
    startTranscription,
    transcribeCaptionSegment,
    updateCaptionSettings,
    updateCaptionSegment,
    setCaptionSegments,
    setCaptionsEnabled,
    setTranscriptionProgress,
    requestSeek,
    setIsPlaying,
    togglePlayback,
  };
}
