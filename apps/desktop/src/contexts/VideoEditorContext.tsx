/**
 * VideoEditorContext - Provides isolated video editor state per window.
 *
 * Each video editor window creates and activates its own store instance.
 * Existing global call sites still work via the active-store bridge.
 */

import { useContext, useEffect, useRef, type ReactNode } from 'react';
import type { StoreApi } from 'zustand';
import {
  createVideoEditorStore,
  getActiveVideoEditorStore,
  resetActiveVideoEditorStore,
  setActiveVideoEditorStore,
  useVideoEditorStore as useVideoEditorStoreHook,
  VideoEditorStoreContext,
  type VideoEditorState,
} from '../stores/videoEditor';
import { videoEditorLogger } from '@/utils/logger';

interface VideoEditorProviderProps {
  children: ReactNode;
}

/**
 * Provider that creates an isolated video editor store for its subtree.
 * Use this in each video editor window to get independent state.
 */
export function VideoEditorProvider({ children }: VideoEditorProviderProps) {
  const storeRef = useRef<StoreApi<VideoEditorState> | null>(null);

  if (!storeRef.current) {
    storeRef.current = createVideoEditorStore();
  }

  // Make this store active before children render so imperative getState/setState
  // call sites in this window use the isolated instance.
  setActiveVideoEditorStore(storeRef.current);

  useEffect(() => {
    return () => {
      // Cleanup GPU editor when provider unmounts
      const store = storeRef.current;
      if (store) {
        const state = store.getState();
        if (state.editorInstanceId) {
          state.destroyGPUEditor().catch((err) =>
            videoEditorLogger.warn('Failed to destroy GPU editor:', err)
          );
        }
      }

      // Restore global fallback store when this isolated provider is removed.
      if (store && getActiveVideoEditorStore() === store) {
        resetActiveVideoEditorStore();
      }
    };
  }, []);

  return (
    <VideoEditorStoreContext.Provider value={storeRef.current}>
      {children}
    </VideoEditorStoreContext.Provider>
  );
}

/**
 * Get the video editor store from context.
 * Throws if used outside of VideoEditorProvider.
 */
export function useVideoEditorContext(): StoreApi<VideoEditorState> {
  const store = useContext(VideoEditorStoreContext);
  if (!store) {
    throw new Error('useVideoEditorContext must be used within a VideoEditorProvider');
  }
  return store;
}

/**
 * Context-aware selector hook for video editor state.
 */
export function useVideoEditor<T>(selector: (state: VideoEditorState) => T): T {
  return useVideoEditorStoreHook(selector);
}

/**
 * Hook to access video editor store actions.
 * Returns stable references to current store actions.
 */
export function useVideoEditorActions() {
  const contextStore = useContext(VideoEditorStoreContext);
  const store = contextStore ?? getActiveVideoEditorStore();
  const state = store.getState();

  return {
    setProject: state.setProject,
    loadCursorData: state.loadCursorData,
    setCurrentTime: state.setCurrentTime,
    togglePlayback: state.togglePlayback,
    setIsPlaying: state.setIsPlaying,
    initializeGPUEditor: state.initializeGPUEditor,
    destroyGPUEditor: state.destroyGPUEditor,
    handlePlaybackEvent: state.handlePlaybackEvent,
    renderFrame: state.renderFrame,
    gpuPlay: state.gpuPlay,
    gpuPause: state.gpuPause,
    gpuSeek: state.gpuSeek,
    selectZoomRegion: state.selectZoomRegion,
    addZoomRegion: state.addZoomRegion,
    updateZoomRegion: state.updateZoomRegion,
    deleteZoomRegion: state.deleteZoomRegion,
    selectTextSegment: state.selectTextSegment,
    addTextSegment: state.addTextSegment,
    updateTextSegment: state.updateTextSegment,
    deleteTextSegment: state.deleteTextSegment,
    selectMaskSegment: state.selectMaskSegment,
    addMaskSegment: state.addMaskSegment,
    updateMaskSegment: state.updateMaskSegment,
    deleteMaskSegment: state.deleteMaskSegment,
    selectSceneSegment: state.selectSceneSegment,
    addSceneSegment: state.addSceneSegment,
    updateSceneSegment: state.updateSceneSegment,
    deleteSceneSegment: state.deleteSceneSegment,
    selectWebcamSegment: state.selectWebcamSegment,
    addWebcamSegment: state.addWebcamSegment,
    updateWebcamSegment: state.updateWebcamSegment,
    deleteWebcamSegment: state.deleteWebcamSegment,
    toggleWebcamAtTime: state.toggleWebcamAtTime,
    updateWebcamConfig: state.updateWebcamConfig,
    updateExportConfig: state.updateExportConfig,
    updateCursorConfig: state.updateCursorConfig,
    updateAudioConfig: state.updateAudioConfig,
    setTimelineZoom: state.setTimelineZoom,
    setTimelineScrollLeft: state.setTimelineScrollLeft,
    toggleTrackVisibility: state.toggleTrackVisibility,
    setDraggingPlayhead: state.setDraggingPlayhead,
    setDraggingZoomRegion: state.setDraggingZoomRegion,
    setDraggingSceneSegment: state.setDraggingSceneSegment,
    setDraggingMaskSegment: state.setDraggingMaskSegment,
    setDraggingTextSegment: state.setDraggingTextSegment,
    setPreviewTime: state.setPreviewTime,
    setHoveredTrack: state.setHoveredTrack,
    setSplitMode: state.setSplitMode,
    splitZoomRegionAtPlayhead: state.splitZoomRegionAtPlayhead,
    deleteSelectedZoomRegion: state.deleteSelectedZoomRegion,
    clearEditor: state.clearEditor,
    generateAutoZoom: state.generateAutoZoom,
    saveProject: state.saveProject,
    exportVideo: state.exportVideo,
    setExportProgress: state.setExportProgress,
    cancelExport: state.cancelExport,
  };
}

/**
 * Get the raw store for imperative access.
 * Returns context store if available, otherwise active store.
 */
export function useVideoEditorStore(): StoreApi<VideoEditorState> {
  const contextStore = useContext(VideoEditorStoreContext);
  return contextStore ?? getActiveVideoEditorStore();
}
