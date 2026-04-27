import type { TrimSegment } from '@/types';
import type { VideoEditorState } from '@/stores/videoEditor/types';

export const selectProject = (state: VideoEditorState) => state.project;
export const selectProjectName = (state: VideoEditorState) => state.project?.name ?? null;
export const selectSetProject = (state: VideoEditorState) => state.setProject;
export const selectScreenVideoPath = (state: VideoEditorState) => state.project?.sources.screenVideo ?? null;
export const selectOriginalVideoWidth = (state: VideoEditorState) => state.project?.sources.originalWidth ?? 1920;
export const selectOriginalVideoHeight = (state: VideoEditorState) => state.project?.sources.originalHeight ?? 1080;
export const selectIsPlaying = (state: VideoEditorState) => state.isPlaying;
export const selectPreviewTimeMs = (state: VideoEditorState) => state.previewTimeMs;
export const selectCurrentTimeMs = (state: VideoEditorState) => state.currentTimeMs;
export const selectRequestSeek = (state: VideoEditorState) => state.requestSeek;
export const selectCursorRecording = (state: VideoEditorState) => state.cursorRecording;
export const selectAudioConfig = (state: VideoEditorState) => state.project?.audio;
export const selectTimelineZoom = (state: VideoEditorState) => state.timelineZoom;
export const selectIsDraggingPlayhead = (state: VideoEditorState) => state.isDraggingPlayhead;
export const selectHoveredTrack = (state: VideoEditorState) => state.hoveredTrack;
export const selectSetHoveredTrack = (state: VideoEditorState) => state.setHoveredTrack;
export const selectSplitMode = (state: VideoEditorState) => state.splitMode;
export const selectSetSplitMode = (state: VideoEditorState) => state.setSplitMode;
export const selectTrackVisibility = (state: VideoEditorState) => state.trackVisibility;
export const selectToggleTrackVisibility = (state: VideoEditorState) => state.toggleTrackVisibility;
export const selectHasWebcam = (state: VideoEditorState) => !!state.project?.sources.webcamVideo;
export const selectExportInPointMs = (state: VideoEditorState) => state.exportInPointMs;
export const selectExportOutPointMs = (state: VideoEditorState) => state.exportOutPointMs;
export const selectActiveUndoDomain = (state: VideoEditorState) => state.activeUndoDomain;
export const selectSetTimelineScrollLeft = (state: VideoEditorState) => state.setTimelineScrollLeft;
export const selectSetTimelineContainerWidth = (state: VideoEditorState) => state.setTimelineContainerWidth;
export const selectSetDraggingPlayhead = (state: VideoEditorState) => state.setDraggingPlayhead;
export const selectSetTimelineZoom = (state: VideoEditorState) => state.setTimelineZoom;
export const selectSetPreviewTime = (state: VideoEditorState) => state.setPreviewTime;
export const selectTogglePlayback = (state: VideoEditorState) => state.togglePlayback;
export const selectFitTimelineToWindow = (state: VideoEditorState) => state.fitTimelineToWindow;
export const selectSetExportInPoint = (state: VideoEditorState) => state.setExportInPoint;
export const selectSetExportOutPoint = (state: VideoEditorState) => state.setExportOutPoint;
export const selectClearExportRange = (state: VideoEditorState) => state.clearExportRange;
export const selectClearEditor = (state: VideoEditorState) => state.clearEditor;
export const selectIsExporting = (state: VideoEditorState) => state.isExporting;
export const selectExportProgress = (state: VideoEditorState) => state.exportProgress;
export const selectExportVideo = (state: VideoEditorState) => state.exportVideo;
export const selectSetExportProgress = (state: VideoEditorState) => state.setExportProgress;
export const selectCancelExport = (state: VideoEditorState) => state.cancelExport;
export const selectUpdateExportConfig = (state: VideoEditorState) => state.updateExportConfig;
export const selectUpdateWebcamConfig = (state: VideoEditorState) => state.updateWebcamConfig;
export const selectUpdateCursorConfig = (state: VideoEditorState) => state.updateCursorConfig;
export const selectUpdateAudioConfig = (state: VideoEditorState) => state.updateAudioConfig;
export const selectSplitAtTimelineTime = (state: VideoEditorState) => state.splitAtTimelineTime;
export const selectSplitAtPlayhead = (state: VideoEditorState) => state.splitAtPlayhead;
export const selectResetTrimSegments = (state: VideoEditorState) => state.resetTrimSegments;
export const selectUndoTrim = (state: VideoEditorState) => state.undoTrim;
export const selectRedoTrim = (state: VideoEditorState) => state.redoTrim;
export const selectSaveProject = (state: VideoEditorState) => state.saveProject;
export const selectIsSaving = (state: VideoEditorState) => state.isSaving;
export const selectIsDraggingAnySegment = (state: VideoEditorState) =>
  state.isDraggingZoomRegion ||
  state.isDraggingSceneSegment ||
  state.isDraggingAnnotationSegment ||
  state.isDraggingMaskSegment ||
  state.isDraggingTextSegment;

export const selectTimelineSegments = (state: VideoEditorState) =>
  state.project?.timeline.segments as TrimSegment[] | undefined;

export const selectSelectedZoomRegionId = (state: VideoEditorState) => state.selectedZoomRegionId;
export const selectSelectZoomRegion = (state: VideoEditorState) => state.selectZoomRegion;
export const selectUpdateZoomRegion = (state: VideoEditorState) => state.updateZoomRegion;
export const selectDeleteZoomRegion = (state: VideoEditorState) => state.deleteZoomRegion;
export const selectAddZoomRegion = (state: VideoEditorState) => state.addZoomRegion;
export const selectSetDraggingZoomRegion = (state: VideoEditorState) => state.setDraggingZoomRegion;

export const selectSelectedMaskSegmentId = (state: VideoEditorState) => state.selectedMaskSegmentId;
export const selectSelectMaskSegment = (state: VideoEditorState) => state.selectMaskSegment;
export const selectUpdateMaskSegment = (state: VideoEditorState) => state.updateMaskSegment;
export const selectDeleteMaskSegment = (state: VideoEditorState) => state.deleteMaskSegment;
export const selectAddMaskSegment = (state: VideoEditorState) => state.addMaskSegment;
export const selectSetDraggingMaskSegment = (state: VideoEditorState) => state.setDraggingMaskSegment;

export const selectSelectedAnnotationSegmentId = (state: VideoEditorState) => state.selectedAnnotationSegmentId;
export const selectSelectedAnnotationShapeId = (state: VideoEditorState) => state.selectedAnnotationShapeId;
export const selectAnnotationDeleteMode = (state: VideoEditorState) => state.annotationDeleteMode;
export const selectSelectAnnotationSegment = (state: VideoEditorState) => state.selectAnnotationSegment;
export const selectSelectAnnotationShape = (state: VideoEditorState) => state.selectAnnotationShape;
export const selectAddAnnotationSegment = (state: VideoEditorState) => state.addAnnotationSegment;
export const selectUpdateAnnotationSegment = (state: VideoEditorState) => state.updateAnnotationSegment;
export const selectDeleteAnnotationSegment = (state: VideoEditorState) => state.deleteAnnotationSegment;
export const selectAddAnnotationShape = (state: VideoEditorState) => state.addAnnotationShape;
export const selectUpdateAnnotationShape = (state: VideoEditorState) => state.updateAnnotationShape;
export const selectDeleteAnnotationShape = (state: VideoEditorState) => state.deleteAnnotationShape;
export const selectUndoAnnotation = (state: VideoEditorState) => state.undoAnnotation;
export const selectRedoAnnotation = (state: VideoEditorState) => state.redoAnnotation;
export const selectBeginAnnotationDrag = (state: VideoEditorState) => state.beginAnnotationDrag;
export const selectCommitAnnotationDrag = (state: VideoEditorState) => state.commitAnnotationDrag;
export const selectSetDraggingAnnotationSegment = (state: VideoEditorState) => state.setDraggingAnnotationSegment;

export const selectSelectedTextSegmentId = (state: VideoEditorState) => state.selectedTextSegmentId;
export const selectSelectTextSegment = (state: VideoEditorState) => state.selectTextSegment;
export const selectUpdateTextSegment = (state: VideoEditorState) => state.updateTextSegment;
export const selectDeleteTextSegment = (state: VideoEditorState) => state.deleteTextSegment;
export const selectAddTextSegment = (state: VideoEditorState) => state.addTextSegment;
export const selectSetDraggingTextSegment = (state: VideoEditorState) => state.setDraggingTextSegment;

export const selectSelectedSceneSegmentId = (state: VideoEditorState) => state.selectedSceneSegmentId;
export const selectSelectSceneSegment = (state: VideoEditorState) => state.selectSceneSegment;
export const selectAddSceneSegment = (state: VideoEditorState) => state.addSceneSegment;
export const selectUpdateSceneSegment = (state: VideoEditorState) => state.updateSceneSegment;
export const selectDeleteSceneSegment = (state: VideoEditorState) => state.deleteSceneSegment;
export const selectSetDraggingSceneSegment = (state: VideoEditorState) => state.setDraggingSceneSegment;

export const selectSelectedTrimSegmentId = (state: VideoEditorState) => state.selectedTrimSegmentId;
export const selectSelectTrimSegment = (state: VideoEditorState) => state.selectTrimSegment;
export const selectUpdateTrimSegment = (state: VideoEditorState) => state.updateTrimSegment;
export const selectUpdateTrimSegmentSpeed = (state: VideoEditorState) => state.updateTrimSegmentSpeed;
export const selectDeleteTrimSegment = (state: VideoEditorState) => state.deleteTrimSegment;

export const selectSelectedWebcamSegmentIndex = (state: VideoEditorState) => state.selectedWebcamSegmentIndex;
export const selectSelectWebcamSegment = (state: VideoEditorState) => state.selectWebcamSegment;
export const selectUpdateWebcamSegment = (state: VideoEditorState) => state.updateWebcamSegment;
export const selectDeleteWebcamSegment = (state: VideoEditorState) => state.deleteWebcamSegment;

export const selectSetIsPlaying = (state: VideoEditorState) => state.setIsPlaying;
export const selectLastSeekToken = (state: VideoEditorState) => state.lastSeekToken;

export const selectCaptionSegments = (state: VideoEditorState) => state.captionSegments;
export const selectCaptionSettings = (state: VideoEditorState) => state.captionSettings;
export const selectIsTranscribing = (state: VideoEditorState) => state.isTranscribing;
export const selectTranscriptionProgress = (state: VideoEditorState) => state.transcriptionProgress;
export const selectTranscriptionStage = (state: VideoEditorState) => state.transcriptionStage;
export const selectTranscriptionError = (state: VideoEditorState) => state.transcriptionError;
export const selectWhisperModels = (state: VideoEditorState) => state.whisperModels;
export const selectSelectedModelName = (state: VideoEditorState) => state.selectedModelName;
export const selectSelectedTranscriptionLanguage = (state: VideoEditorState) =>
  state.selectedTranscriptionLanguage;
export const selectIsDownloadingModel = (state: VideoEditorState) => state.isDownloadingModel;
export const selectDownloadProgress = (state: VideoEditorState) => state.downloadProgress;
export const selectLoadWhisperModels = (state: VideoEditorState) => state.loadWhisperModels;
export const selectSetSelectedModel = (state: VideoEditorState) => state.setSelectedModel;
export const selectSetSelectedTranscriptionLanguage = (state: VideoEditorState) =>
  state.setSelectedTranscriptionLanguage;
export const selectDownloadModel = (state: VideoEditorState) => state.downloadModel;
export const selectStartTranscription = (state: VideoEditorState) => state.startTranscription;
export const selectTranscribeCaptionSegment = (state: VideoEditorState) => state.transcribeCaptionSegment;
export const selectUpdateCaptionSettings = (state: VideoEditorState) => state.updateCaptionSettings;
export const selectUpdateCaptionSegment = (state: VideoEditorState) => state.updateCaptionSegment;
export const selectSetCaptionSegments = (state: VideoEditorState) => state.setCaptionSegments;
export const selectClearCaptions = (state: VideoEditorState) => state.clearCaptions;
export const selectSetCaptionsEnabled = (state: VideoEditorState) => state.setCaptionsEnabled;
export const selectSetTranscriptionProgress = (state: VideoEditorState) => state.setTranscriptionProgress;
