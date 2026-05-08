/**
 * VideoEditorSidebar - Right sidebar with tabbed properties panel.
 * Contains Project, Style, Captions, and Export tabs.
 */
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, MousePointer2, Palette, Video } from 'lucide-react';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectAddAnnotationShape,
  selectDeleteAnnotationSegment,
  selectDeleteAnnotationShape,
  selectDeleteMaskSegment,
  selectDeleteSceneSegment,
  selectDeleteTextSegment,
  selectDeleteZoomRegion,
  selectSelectAnnotationSegment,
  selectSelectAnnotationShape,
  selectSelectMaskSegment,
  selectSelectSceneSegment,
  selectSelectTextSegment,
  selectSelectZoomRegion,
  selectSelectedAnnotationSegmentId,
  selectSelectedAnnotationShapeId,
  selectUpdateAnnotationShape,
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
import { ProFeature } from '../../components/ProFeature';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';
import { AnnotationSegmentConfig } from './AnnotationSegmentConfig';
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
import { createDefaultAnnotationShape, getNextAnnotationStepNumber } from '../../utils/videoAnnotations';
import type { SceneMode, VideoProject } from '../../types';
import { LAYOUT } from '../../constants';

export interface VideoEditorSidebarProps {
  project: VideoProject | null;
  onOpenCropDialog: () => void;
}

interface SidebarSettingsSectionProps {
  title: string;
  description: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}

function SidebarSettingsSection({
  title,
  description,
  icon,
  defaultOpen = false,
  children,
}: SidebarSettingsSectionProps) {
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className="video-sidebar-section">
      <button
        type="button"
        className="video-sidebar-section__trigger"
        aria-expanded={isOpen}
        aria-controls={contentId}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="video-sidebar-section__icon">{icon}</span>
        <span className="min-w-0 flex-1 text-left">
          <span className="video-sidebar-section__title">{title}</span>
          <span className="video-sidebar-section__description">{description}</span>
        </span>
        <ChevronDown
          className={`video-sidebar-section__chevron ${isOpen ? 'video-sidebar-section__chevron--open' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div id={contentId} className="video-sidebar-section__content">
          {children}
        </div>
      )}
    </section>
  );
}

export function VideoEditorSidebar({ project, onOpenCropDialog }: VideoEditorSidebarProps) {
  const updateWebcamConfig = useVideoEditorStore(selectUpdateWebcamConfig);
  const updateExportConfig = useVideoEditorStore(selectUpdateExportConfig);
  const updateCursorConfig = useVideoEditorStore(selectUpdateCursorConfig);
  const updateAudioConfig = useVideoEditorStore(selectUpdateAudioConfig);
  const selectedAnnotationSegmentId = useVideoEditorStore(selectSelectedAnnotationSegmentId);
  const selectedAnnotationShapeId = useVideoEditorStore(selectSelectedAnnotationShapeId);
  const selectAnnotationSegment = useVideoEditorStore(selectSelectAnnotationSegment);
  const selectAnnotationShape = useVideoEditorStore(selectSelectAnnotationShape);
  const addAnnotationShape = useVideoEditorStore(selectAddAnnotationShape);
  const updateAnnotationShape = useVideoEditorStore(selectUpdateAnnotationShape);
  const deleteAnnotationSegment = useVideoEditorStore(selectDeleteAnnotationSegment);
  const deleteAnnotationShape = useVideoEditorStore(selectDeleteAnnotationShape);
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
    if (selectedAnnotationSegmentId) selectAnnotationSegment(null);
    if (selectedMaskSegmentId) selectMaskSegment(null);
    if (selectedTextSegmentId) selectTextSegment(null);
    setActiveTab(tab);
  };

  // Check if any segment is selected for overlay display
  const hasSelectedSegment =
    selectedZoomRegionId ||
    selectedSceneSegmentId ||
    selectedAnnotationSegmentId ||
    selectedMaskSegmentId ||
    selectedTextSegmentId;

  return (
    <div
      className="compositor-sidebar flex flex-col shrink-0"
      style={{
        width: LAYOUT.VIDEO_EDITOR_SIDEBAR_WIDTH,
        minWidth: LAYOUT.VIDEO_EDITOR_SIDEBAR_WIDTH,
        maxWidth: LAYOUT.VIDEO_EDITOR_SIDEBAR_WIDTH,
      }}
    >
      {/* Tab Bar */}
      <SidebarTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Tab Content */}
      <div className="relative min-w-0 flex-1 overflow-y-auto">
        {/* Selection Overlay (shown when zoom region, scene segment, mask, or text is selected) */}
        {hasSelectedSegment && project && (
          <div className="absolute inset-0 min-w-0 overflow-y-auto bg-[var(--glass-surface-dark)] p-4 z-10 animate-in slide-in-from-bottom-2 fade-in duration-200">
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
              const isRedundantDefaultSegment = segment.mode === 'default';
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
                      {isRedundantDefaultSegment && (
                        <p className="mb-2 text-xs text-[var(--ink-subtle)]">
                          This segment already matches the default scene mode. Delete it to remove the redundant override.
                        </p>
                      )}
                      <Select
                        value={isRedundantDefaultSegment ? undefined : segment.mode}
                        onValueChange={(value) =>
                          updateSceneSegment(selectedSceneSegmentId, {
                            mode: value as SceneMode,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
                          <SelectValue placeholder="No override selected" />
                        </SelectTrigger>
                        <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
                          <SelectItem value="cameraOnly">Camera Only</SelectItem>
                          <SelectItem value="screenOnly">Screen Only</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Annotation Segment Properties */}
            {selectedAnnotationSegmentId && (() => {
              const segment = (project.annotations?.segments ?? []).find((entry) => entry.id === selectedAnnotationSegmentId);
              if (!segment) return null;

              return (
                <AnnotationSegmentConfig
                  segment={segment}
                  selectedShapeId={selectedAnnotationShapeId}
                  onSelectShape={selectAnnotationShape}
                  onAddShape={(shapeType) => {
                    const annotationSegments = project.annotations?.segments ?? [];
                    addAnnotationShape(
                      selectedAnnotationSegmentId,
                      createDefaultAnnotationShape(
                        shapeType,
                        shapeType === 'step'
                          ? { number: getNextAnnotationStepNumber(annotationSegments) }
                          : {}
                      )
                    );
                  }}
                  onUpdateShape={(shapeId, updates) => {
                    updateAnnotationShape(selectedAnnotationSegmentId, shapeId, updates);
                  }}
                  onDeleteShape={(shapeId) => {
                    deleteAnnotationShape(selectedAnnotationSegmentId, shapeId);
                  }}
                  onDeleteSegment={() => {
                    deleteAnnotationSegment(selectedAnnotationSegmentId);
                    selectAnnotationSegment(null);
                  }}
                  onDone={() => selectAnnotationSegment(null)}
                />
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

        {/* Captions Tab */}
        {activeTab === 'captions' && (
          <div className="p-4">
            <ProFeature featureName="Auto Captions">
              <CaptionPanel videoPath={project?.sources.screenVideo || null} />
            </ProFeature>
          </div>
        )}

        {/* Style Tab */}
        {activeTab === 'background' && project && (
          <div className="min-w-0 p-4">
            <div className="video-sidebar-section-stack">
              {project.sources.cursorData && (
                <SidebarSettingsSection
                  title="Cursor"
                  description="Pointer scale, smoothing, and click highlights"
                  icon={<MousePointer2 className="h-3.5 w-3.5" />}
                  defaultOpen
                >
                  <CursorConfigPanel
                    project={project}
                    onUpdateCursorConfig={updateCursorConfig}
                  />
                </SidebarSettingsSection>
              )}

              {project.sources.webcamVideo && (
                <SidebarSettingsSection
                  title="Webcam"
                  description="Camera size, position, shape, and visibility"
                  icon={<Video className="h-3.5 w-3.5" />}
                  defaultOpen={!project.sources.cursorData}
                >
                  <ProFeature featureName="Webcam Overlay">
                    <WebcamConfigPanel
                      project={project}
                      onUpdateWebcamConfig={updateWebcamConfig}
                    />
                  </ProFeature>
                </SidebarSettingsSection>
              )}

              <SidebarSettingsSection
                title="Background"
                description="Canvas padding, corners, shadows, and frame style"
                icon={<Palette className="h-3.5 w-3.5" />}
                defaultOpen={!project.sources.cursorData && !project.sources.webcamVideo}
              >
                <ProFeature featureName="Custom Backgrounds">
                  <BackgroundSettings
                    background={project.export.background}
                    onUpdate={(updates) => updateExportConfig({
                      background: { ...project.export.background, ...updates }
                    })}
                  />
                </ProFeature>
              </SidebarSettingsSection>
            </div>
          </div>
        )}

        {/* Export Tab */}
        {activeTab === 'export' && project && (
          <div className="min-w-0 p-4">
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
