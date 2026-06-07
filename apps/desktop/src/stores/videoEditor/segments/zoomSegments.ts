import type { SliceCreator, ZoomRegion } from '../types';
import { snapshotOverlayState } from '../overlayAdjustment';
import { pushTrimHistory } from '../trimSlice';
import { clampSegmentToDuration, ensureTrimHistoryInitialized } from './shared';

/**
 * Generate a unique zoom region ID
 */
export function generateZoomRegionId(): string {
  return `zoom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export interface ZoomSegmentsSlice {
  selectedZoomRegionId: string | null;

  selectZoomRegion: (id: string | null) => void;
  addZoomRegion: (region: ZoomRegion) => void;
  updateZoomRegion: (id: string, updates: Partial<ZoomRegion>) => void;
  deleteZoomRegion: (id: string) => void;
  splitZoomRegionAtPlayhead: () => void;
  deleteSelectedZoomRegion: () => void;
}

export const createZoomSegmentsSlice: SliceCreator<ZoomSegmentsSlice> = (set, get) => ({
  selectedZoomRegionId: null,

  selectZoomRegion: (id) =>
    set({
      selectedZoomRegionId: id,
      selectedSceneSegmentId: null,
      selectedTextSegmentId: null,
      selectedAnnotationSegmentId: null,
      selectedAnnotationShapeId: null,
      annotationDeleteMode: null,
      selectedMaskSegmentId: null,
      selectedWebcamSegmentIndex: null,
    }),

  addZoomRegion: (region) => {
    const { project } = get();
    if (!project) return;

    const clampedRegion = clampSegmentToDuration(region, project.timeline.durationMs);

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: [...project.zoom.regions, clampedRegion],
        },
      },
      selectedZoomRegionId: clampedRegion.id,
    });
  },

  updateZoomRegion: (id, updates) => {
    const {
      project,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const newRegions = project.zoom.regions.map((r) => (r.id === id ? { ...r, ...updates } : r));
    const overlays = snapshotOverlayState(project);
    overlays.zoomRegions = newRegions;
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: newRegions,
        },
      },
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  deleteZoomRegion: (id) => {
    const {
      project,
      selectedZoomRegionId,
      selectedTrimSegmentId,
      trimHistory,
      trimHistoryIndex,
    } = get();
    if (!project) return;

    const seed = ensureTrimHistoryInitialized(
      project,
      trimHistory,
      trimHistoryIndex,
      selectedTrimSegmentId
    );
    const overlays = snapshotOverlayState(project);
    overlays.zoomRegions = project.zoom.regions.filter((r) => r.id !== id);
    const { history, index } = pushTrimHistory(seed.history, seed.index, {
      segments: [...project.timeline.segments],
      selectedId: selectedTrimSegmentId,
      overlays,
    });

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: overlays.zoomRegions,
        },
      },
      selectedZoomRegionId: selectedZoomRegionId === id ? null : selectedZoomRegionId,
      activeUndoDomain: 'trim',
      trimHistory: history,
      trimHistoryIndex: index,
    });
  },

  splitZoomRegionAtPlayhead: () => {
    const { project, currentTimeMs, selectedZoomRegionId } = get();
    if (!project || !selectedZoomRegionId) return;

    const region = project.zoom.regions.find((r) => r.id === selectedZoomRegionId);
    if (!region) return;

    // Check if playhead is within the region (with some margin)
    const minDuration = 100; // Minimum 100ms per segment
    if (currentTimeMs <= region.startMs + minDuration || currentTimeMs >= region.endMs - minDuration) {
      return; // Can't split at edges or if segments would be too small
    }

    // Create two new regions from the split
    const region1: ZoomRegion = {
      ...region,
      id: generateZoomRegionId(),
      endMs: currentTimeMs,
    };

    const region2: ZoomRegion = {
      ...region,
      id: generateZoomRegionId(),
      startMs: currentTimeMs,
    };

    // Replace original with two new regions
    const newRegions = project.zoom.regions
      .filter((r) => r.id !== selectedZoomRegionId)
      .concat([region1, region2])
      .sort((a, b) => a.startMs - b.startMs);

    set({
      project: {
        ...project,
        zoom: {
          ...project.zoom,
          regions: newRegions,
        },
      },
      selectedZoomRegionId: region1.id, // Select the first part
    });
  },

  deleteSelectedZoomRegion: () => {
    const { selectedZoomRegionId, deleteZoomRegion } = get();
    if (selectedZoomRegionId) {
      deleteZoomRegion(selectedZoomRegionId);
    }
  },
});
