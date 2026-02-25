/**
 * VideoEditorSidebar - Right sidebar with tabbed properties panel.
 * Contains Project, Cursor, Webcam, Captions, Style, and Export tabs.
 */
import { useState } from 'react';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectDeleteMaskSegment,
  selectDeleteSceneSegment,
  selectDeleteTextSegment,
  selectDeleteZoomRegion,
  selectSelectMaskSegment,
  selectSelectSceneSegment,
  selectSelectTextSegment,
  selectSelectZoomRegion,
  selectSelectedMaskSegmentId,
  selectSelectedSceneSegmentId,
  selectSelectedTextSegmentId,
  selectSelectedZoomRegionId,
  selectUpdateAudioConfig,
  selectUpdateCursorConfig,
  selectUpdateExportConfig,
  selectUpdateMaskSegment,
  selectUpdateSceneSegment,
  selectUpdateTextSegment,
  selectUpdateWebcamConfig,
  selectUpdateZoomRegion,
} from '../../stores/videoEditor/selectors';
import { BackgroundSettings } from '../../components/VideoEditor/BackgroundSettings';
import { ZoomRegionConfig } from './ZoomRegionConfig';
import { MaskSegmentConfig } from './MaskSegmentConfig';
import { TextSegmentConfig } from './TextSegmentConfig';
import { CaptionPanel } from './CaptionPanel';
import { SidebarTabBar, type PropertiesTab } from './components/SidebarTabBar';
import { ProjectInfoPanel } from './panels/ProjectInfoPanel';
import { CursorConfigPanel } from './panels/CursorConfigPanel';
import { WebcamConfigPanel } from './panels/WebcamConfigPanel';
import { ExportConfigPanel } from './panels/ExportConfigPanel';
import { findTextSegmentById } from '../../utils/textSegmentId';
import type { SceneMode, VideoProject } from '../../types';

export interface VideoEditorSidebarProps {
  project: VideoProject | null;
  onOpenCropDialog: () => void;
}

export function VideoEditorSidebar({ project, onOpenCropDialog }: VideoEditorSidebarProps) {
  const updateWebcamConfig = useVideoEditorStore(selectUpdateWebcamConfig);
  const updateExportConfig = useVideoEditorStore(selectUpdateExportConfig);
  const updateCursorConfig = useVideoEditorStore(selectUpdateCursorConfig);
  const updateAudioConfig = useVideoEditorStore(selectUpdateAudioConfig);
  const selectedZoomRegionId = useVideoEditorStore(selectSelectedZoomRegionId);
  const selectZoomRegion = useVideoEditorStore(selectSelectZoomRegion);
  const updateZoomRegion = useVideoEditorStore(selectUpdateZoomRegion);
  const deleteZoomRegion = useVideoEditorStore(selectDeleteZoomRegion);
  const selectedSceneSegmentId = useVideoEditorStore(selectSelectedSceneSegmentId);
  const selectSceneSegment = useVideoEditorStore(selectSelectSceneSegment);
  const updateSceneSegment = useVideoEditorStore(selectUpdateSceneSegment);
  const deleteSceneSegment = useVideoEditorStore(selectDeleteSceneSegment);
  const selectedMaskSegmentId = useVideoEditorStore(selectSelectedMaskSegmentId);
  const selectMaskSegment = useVideoEditorStore(selectSelectMaskSegment);
  const updateMaskSegment = useVideoEditorStore(selectUpdateMaskSegment);
  const deleteMaskSegment = useVideoEditorStore(selectDeleteMaskSegment);
  const selectedTextSegmentId = useVideoEditorStore(selectSelectedTextSegmentId);
  const selectTextSegment = useVideoEditorStore(selectSelectTextSegment);
  const updateTextSegment = useVideoEditorStore(selectUpdateTextSegment);
  const deleteTextSegment = useVideoEditorStore(selectDeleteTextSegment);

  // Properties panel tab state
  const [activeTab, setActiveTab] = useState<PropertiesTab>('project');

  // Clicking a sidebar tab dismisses any open segment properties overlay
  const handleTabChange = (tab: PropertiesTab) => {
    if (selectedZoomRegionId) selectZoomRegion(null);
    if (selectedSceneSegmentId) selectSceneSegment(null);
    if (selectedMaskSegmentId) selectMaskSegment(null);
    if (selectedTextSegmentId) selectTextSegment(null);
    setActiveTab(tab);
  };

  // Check if any segment is selected for overlay display
  const hasSelectedSegment = selectedZoomRegionId || selectedSceneSegmentId || selectedMaskSegmentId || selectedTextSegmentId;

  return (
    <div className="w-92 compositor-sidebar flex flex-col">
      {/* Tab Bar */}
      <SidebarTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasCursor={!!project?.sources.cursorData}
        hasWebcam={!!project?.sources.webcamVideo}
      />

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto relative">
        {/* Selection Overlay (shown when zoom region, scene segment, mask, or text is selected) */}
        {hasSelectedSegment && project && (
          <div className="absolute inset-0 p-4 bg-[var(--glass-surface-dark)] z-10 animate-in slide-in-from-bottom-2 fade-in duration-200 overflow-y-auto">
            {/* Zoom Region Properties */}
            {selectedZoomRegionId && project.zoom.regions.find(r => r.id === selectedZoomRegionId) && (
              <ZoomRegionConfig
                region={project.zoom.regions.find(r => r.id === selectedZoomRegionId)!}
                videoSrc={project.sources.screenVideo}
                canUseAuto={project.sources.cursorData != null}
                onUpdate={(updates) => updateZoomRegion(selectedZoomRegionId, updates)}
                onDelete={() => {
                  deleteZoomRegion(selectedZoomRegionId);
                  selectZoomRegion(null);
                }}
                onDone={() => selectZoomRegion(null)}
              />
            )}

            {/* Scene Segment Properties */}
            {selectedSceneSegmentId && (() => {
              const segment = project.scene.segments.find(s => s.id === selectedSceneSegmentId);
              if (!segment) return null;
              return (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => selectSceneSegment(null)}
                        className="h-7 px-2.5 bg-[var(--coral-100)] hover:bg-[var(--coral-200)] text-[var(--coral-400)] text-xs font-medium rounded-md transition-colors"
                      >
                        Done
                      </button>
                      <span className="text-xs text-[var(--ink-subtle)]">Scene segment</span>
                    </div>
                    <button
                      onClick={() => {
                        deleteSceneSegment(selectedSceneSegmentId);
                        selectSceneSegment(null);
                      }}
                      className="h-7 px-2.5 bg-[var(--error-light)] hover:bg-[rgba(239,68,68,0.2)] text-[var(--error)] text-xs rounded-md transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                  <div className="space-y-3 pt-2">
                    <div>
                      <span className="text-xs text-[var(--ink-muted)] block mb-2">Mode</span>
                      <select
                        value={segment.mode}
                        onChange={(e) => updateSceneSegment(selectedSceneSegmentId, { mode: e.target.value as SceneMode })}
                        className="w-full h-8 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2"
                      >
                        <option value="default">Screen + Webcam</option>
                        <option value="cameraOnly">Camera Only</option>
                        <option value="screenOnly">Screen Only</option>
                      </select>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Mask Segment Properties */}
            {selectedMaskSegmentId && project.mask?.segments.find(s => s.id === selectedMaskSegmentId) && (
              <MaskSegmentConfig
                segment={project.mask.segments.find(s => s.id === selectedMaskSegmentId)!}
                onUpdate={(updates) => updateMaskSegment(selectedMaskSegmentId, updates)}
                onDelete={() => {
                  deleteMaskSegment(selectedMaskSegmentId);
                  selectMaskSegment(null);
                }}
                onDone={() => selectMaskSegment(null)}
              />
            )}

            {/* Text Segment Properties */}
            {selectedTextSegmentId && (() => {
              const segment = findTextSegmentById(project.text?.segments, selectedTextSegmentId);
              if (!segment) return null;
              return (
                <TextSegmentConfig
                  segment={segment}
                  onUpdate={(updates) => updateTextSegment(selectedTextSegmentId, updates)}
                  onDelete={() => {
                    deleteTextSegment(selectedTextSegmentId);
                    selectTextSegment(null);
                  }}
                  onDone={() => selectTextSegment(null)}
                />
              );
            })()}
          </div>
        )}

        {/* Project Tab */}
        {activeTab === 'project' && (
          <div className="p-4 space-y-4">
            <ProjectInfoPanel project={project} />
          </div>
        )}

        {/* Cursor Tab */}
        {activeTab === 'cursor' && project?.sources.cursorData && (
          <div className="p-4">
            <CursorConfigPanel
              project={project}
              onUpdateCursorConfig={updateCursorConfig}
            />
          </div>
        )}

        {/* Webcam Tab */}
        {activeTab === 'webcam' && project?.sources.webcamVideo && (
          <div className="p-4">
            <WebcamConfigPanel
              project={project}
              onUpdateWebcamConfig={updateWebcamConfig}
            />
          </div>
        )}

        {/* Captions Tab */}
        {activeTab === 'captions' && (
          <div className="p-4">
            <CaptionPanel videoPath={project?.sources.screenVideo || null} />
          </div>
        )}

        {/* Background/Style Tab */}
        {activeTab === 'background' && project && (
          <div className="p-4">
            <BackgroundSettings
              background={project.export.background}
              onUpdate={(updates) => updateExportConfig({
                background: { ...project.export.background, ...updates }
              })}
            />
          </div>
        )}

        {/* Export Tab */}
        {activeTab === 'export' && project && (
          <div className="p-4">
            <ExportConfigPanel
              project={project}
              onUpdateExportConfig={updateExportConfig}
              onUpdateAudioConfig={updateAudioConfig}
              onOpenCropDialog={onOpenCropDialog}
            />
          </div>
        )}
      </div>
    </div>
  );
}
