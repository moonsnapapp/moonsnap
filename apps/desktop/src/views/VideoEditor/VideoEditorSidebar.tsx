/**
 * VideoEditorSidebar - Right sidebar with tabbed properties panel.
 * Contains Project, Style, Captions, and Export tabs.
 */
import { useCallback, useId, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, MousePointer2, Video } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, type Transition } from 'motion/react';
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
  selectReorderAnnotationShape,
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
import { CursorConfigPanel } from './panels/CursorConfigPanel';
import { WebcamConfigPanel } from './panels/WebcamConfigPanel';
import { AudioControlsPanel } from './panels/AudioControlsPanel';
import { findTextSegmentById } from '../../utils/textSegmentId';
import { createDefaultAnnotationShape, getNextAnnotationStepNumber } from '../../utils/videoAnnotations';
import type { SceneMode, VideoProject } from '../../types';

export interface VideoEditorSidebarProps {
  project: VideoProject | null;
}

interface SidebarSettingsSectionProps {
  title: string;
  description?: string;
  icon: ReactNode;
  defaultOpen?: boolean;
  variant?: 'card' | 'flat';
  children: ReactNode;
}

const SELECTION_OVERLAY_INITIAL = {
  opacity: 0,
  transform: 'translateY(10px) scale(0.985)',
};
const SELECTION_OVERLAY_ANIMATE = {
  opacity: 1,
  transform: 'translateY(0px) scale(1)',
};
const SELECTION_OVERLAY_EXIT = {
  opacity: 0,
  transform: 'translateY(6px) scale(0.99)',
};
const SELECTION_OVERLAY_TRANSITION = {
  duration: 0.18,
  ease: [0.23, 1, 0.32, 1],
} satisfies Transition;
const SELECTION_OVERLAY_REDUCED_TRANSITION = {
  duration: 0,
} satisfies Transition;

function getSidebarSectionClassName(variant: SidebarSettingsSectionProps['variant']) {
  return [
    'video-sidebar-section',
    variant === 'flat' ? 'video-sidebar-section--flat' : null,
  ].filter(Boolean).join(' ');
}

function getSidebarChevronClassName(isOpen: boolean) {
  return [
    'video-sidebar-section__chevron',
    isOpen ? 'video-sidebar-section__chevron--open' : null,
  ].filter(Boolean).join(' ');
}

function SidebarSectionDescription({ description }: { description?: string }) {
  if (!description) {
    return null;
  }

  return <span className="video-sidebar-section__description">{description}</span>;
}

function SidebarSectionContent({
  contentId,
  isOpen,
  children,
}: {
  contentId: string;
  isOpen: boolean;
  children: ReactNode;
}) {
  if (!isOpen) {
    return null;
  }

  return (
    <div id={contentId} className="video-sidebar-section__content">
      {children}
    </div>
  );
}

function SidebarSettingsSection({
  title,
  description,
  icon,
  defaultOpen = false,
  variant = 'card',
  children,
}: SidebarSettingsSectionProps) {
  const contentId = useId();
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <section className={getSidebarSectionClassName(variant)}>
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
          <SidebarSectionDescription description={description} />
        </span>
        <ChevronDown
          className={getSidebarChevronClassName(isOpen)}
          aria-hidden="true"
        />
      </button>

      <SidebarSectionContent contentId={contentId} isOpen={isOpen}>
        {children}
      </SidebarSectionContent>
    </section>
  );
}

type ZoomRegionUpdate = Parameters<ComponentProps<typeof ZoomRegionConfig>['onUpdate']>[0];
type SceneSegmentUpdate = { mode: SceneMode };
type MaskSegmentUpdate = Parameters<ComponentProps<typeof MaskSegmentConfig>['onUpdate']>[0];
type TextSegmentUpdate = Parameters<ComponentProps<typeof TextSegmentConfig>['onUpdate']>[0];
type AnnotationShapeType = Parameters<ComponentProps<typeof AnnotationSegmentConfig>['onAddShape']>[0];
type AnnotationShapeUpdate = Parameters<ComponentProps<typeof AnnotationSegmentConfig>['onUpdateShape']>[1];
type CursorConfigUpdater = ReturnType<typeof selectUpdateCursorConfig>;
type WebcamConfigUpdater = ReturnType<typeof selectUpdateWebcamConfig>;
type AudioConfigUpdater = ReturnType<typeof selectUpdateAudioConfig>;
type ExportConfigUpdater = ReturnType<typeof selectUpdateExportConfig>;
type ZoomSelectionOverlayProps = Pick<
  SelectionOverlayProps,
  | 'project'
  | 'selectedZoomRegionId'
  | 'selectZoomRegion'
  | 'updateZoomRegion'
  | 'deleteZoomRegion'
>;
type AnnotationSelectionOverlayProps = Pick<
  SelectionOverlayProps,
  | 'project'
  | 'selectedAnnotationSegmentId'
  | 'selectedAnnotationShapeId'
  | 'selectAnnotationSegment'
  | 'selectAnnotationShape'
  | 'addAnnotationShape'
  | 'updateAnnotationShape'
  | 'reorderAnnotationShape'
  | 'deleteAnnotationSegment'
  | 'deleteAnnotationShape'
>;
type MaskSelectionOverlayProps = Pick<
  SelectionOverlayProps,
  | 'project'
  | 'selectedMaskSegmentId'
  | 'selectMaskSegment'
  | 'updateMaskSegment'
  | 'deleteMaskSegment'
>;
type TextSelectionOverlayProps = Pick<
  SelectionOverlayProps,
  | 'project'
  | 'selectedTextSegmentId'
  | 'selectTextSegment'
  | 'updateTextSegment'
  | 'deleteTextSegment'
>;

interface SelectionOverlayProps {
  project: VideoProject;
  selectedZoomRegionId: string | null;
  selectedSceneSegmentId: string | null;
  selectedAnnotationSegmentId: string | null;
  selectedAnnotationShapeId: string | null;
  selectedMaskSegmentId: string | null;
  selectedTextSegmentId: string | null;
  selectZoomRegion: (id: string | null) => void;
  selectSceneSegment: (id: string | null) => void;
  selectAnnotationSegment: (id: string | null) => void;
  selectAnnotationShape: (id: string | null) => void;
  selectMaskSegment: (id: string | null) => void;
  selectTextSegment: (id: string | null) => void;
  updateZoomRegion: (id: string, updates: ZoomRegionUpdate) => void;
  updateSceneSegment: (id: string, updates: SceneSegmentUpdate) => void;
  updateMaskSegment: (id: string, updates: MaskSegmentUpdate) => void;
  updateTextSegment: (id: string, updates: TextSegmentUpdate) => void;
  addAnnotationShape: (segmentId: string, shape: ReturnType<typeof createDefaultAnnotationShape>) => void;
  updateAnnotationShape: (segmentId: string, shapeId: string, updates: AnnotationShapeUpdate) => void;
  reorderAnnotationShape: (segmentId: string, shapeId: string, targetIndex: number) => void;
  deleteZoomRegion: (id: string) => void;
  deleteSceneSegment: (id: string) => void;
  deleteAnnotationSegment: (id: string) => void;
  deleteAnnotationShape: (segmentId: string, shapeId: string) => void;
  deleteMaskSegment: (id: string) => void;
  deleteTextSegment: (id: string) => void;
}

function getSelectedSceneSegment(project: VideoProject, selectedSceneSegmentId: string | null) {
  return findEntryByNullableId(project.scene.segments, selectedSceneSegmentId);
}

function getSceneModeSelectValue(mode: SceneMode) {
  return mode === 'default' ? undefined : mode;
}

function RedundantDefaultSceneNotice({ mode }: { mode: SceneMode }) {
  if (mode !== 'default') {
    return null;
  }

  return (
    <p className="mb-2 text-xs text-[var(--ink-subtle)]">
      This segment already matches the default scene mode. Delete it to remove the redundant override.
    </p>
  );
}

function findEntryByNullableId<T extends { id: string }>(
  entries: T[] | undefined,
  selectedId: string | null
): T | null {
  if (!selectedId) {
    return null;
  }

  return entries?.find((entry) => entry.id === selectedId) ?? null;
}

function SceneSegmentOverlay({
  project,
  selectedSceneSegmentId,
  selectSceneSegment,
  updateSceneSegment,
  deleteSceneSegment,
}: Pick<
  SelectionOverlayProps,
  | 'project'
  | 'selectedSceneSegmentId'
  | 'selectSceneSegment'
  | 'updateSceneSegment'
  | 'deleteSceneSegment'
>) {
  const segment = getSelectedSceneSegment(project, selectedSceneSegmentId);
  if (!segment) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={() => selectSceneSegment(null)}
            className="h-7 px-2.5 bg-[var(--accent-100)] hover:bg-[var(--accent-200)] text-[var(--accent-400)] text-xs font-medium rounded-md transition-colors"
          >
            Done
          </button>
          <span className="text-xs text-[var(--ink-subtle)]">Scene segment</span>
        </div>
        <button
          onClick={() => {
            deleteSceneSegment(segment.id);
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
          <RedundantDefaultSceneNotice mode={segment.mode} />
          <Select
            value={getSceneModeSelectValue(segment.mode)}
            onValueChange={(value) =>
              updateSceneSegment(segment.id, {
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
}

function createAnnotationShapeForType(
  shapeType: AnnotationShapeType,
  annotationSegments: NonNullable<VideoProject['annotations']>['segments']
) {
  const options =
    shapeType === 'step'
      ? { number: getNextAnnotationStepNumber(annotationSegments) }
      : {};
  return createDefaultAnnotationShape(shapeType, options);
}

function ZoomSelectionOverlay({
  project,
  selectedZoomRegionId,
  selectZoomRegion,
  updateZoomRegion,
  deleteZoomRegion,
}: ZoomSelectionOverlayProps) {
  const zoomRegion = selectedZoomRegionId
    ? project.zoom.regions.find((entry) => entry.id === selectedZoomRegionId)
    : null;
  if (!selectedZoomRegionId || !zoomRegion) return null;

  return (
    <ZoomRegionConfig
      region={zoomRegion}
      videoSrc={project.sources.screenVideo}
      canUseAuto={project.sources.cursorData != null}
      onUpdate={(updates) => updateZoomRegion(selectedZoomRegionId, updates)}
      onDelete={() => {
        deleteZoomRegion(selectedZoomRegionId);
        selectZoomRegion(null);
      }}
      onDone={() => selectZoomRegion(null)}
    />
  );
}

function getSelectedAnnotationSegment(
  project: VideoProject,
  selectedAnnotationSegmentId: string | null
) {
  return findEntryByNullableId(getAnnotationSegments(project), selectedAnnotationSegmentId);
}

function getSelectedTextSegmentEntry(project: VideoProject, selectedTextSegmentId: string | null) {
  if (!selectedTextSegmentId) {
    return null;
  }

  const segment = findTextSegmentById(project.text?.segments, selectedTextSegmentId);
  return segment ? { id: selectedTextSegmentId, segment } : null;
}

function getAnnotationSegments(project: VideoProject) {
  return project.annotations?.segments ?? [];
}

function AnnotationSelectionOverlay({
  project,
  selectedAnnotationSegmentId,
  selectedAnnotationShapeId,
  selectAnnotationSegment,
  selectAnnotationShape,
  addAnnotationShape,
  updateAnnotationShape,
  reorderAnnotationShape,
  deleteAnnotationSegment,
  deleteAnnotationShape,
}: AnnotationSelectionOverlayProps) {
  const annotationSegment = getSelectedAnnotationSegment(project, selectedAnnotationSegmentId);
  if (!selectedAnnotationSegmentId || !annotationSegment) return null;

  return (
    <AnnotationSegmentConfig
      segment={annotationSegment}
      selectedShapeId={selectedAnnotationShapeId}
      onSelectShape={selectAnnotationShape}
      onAddShape={(shapeType) => {
        const annotationSegments = getAnnotationSegments(project);
        addAnnotationShape(
          selectedAnnotationSegmentId,
          createAnnotationShapeForType(shapeType, annotationSegments)
        );
      }}
      onUpdateShape={(shapeId, updates) => {
        updateAnnotationShape(selectedAnnotationSegmentId, shapeId, updates);
      }}
      onReorderShape={(shapeId, targetIndex) => {
        reorderAnnotationShape(selectedAnnotationSegmentId, shapeId, targetIndex);
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
}

function MaskSelectionOverlay({
  project,
  selectedMaskSegmentId,
  selectMaskSegment,
  updateMaskSegment,
  deleteMaskSegment,
}: MaskSelectionOverlayProps) {
  const maskSegment = selectedMaskSegmentId
    ? project.mask?.segments.find((entry) => entry.id === selectedMaskSegmentId)
    : null;
  if (!selectedMaskSegmentId || !maskSegment) return null;

  return (
    <MaskSegmentConfig
      segment={maskSegment}
      onUpdate={(updates) => updateMaskSegment(selectedMaskSegmentId, updates)}
      onDelete={() => {
        deleteMaskSegment(selectedMaskSegmentId);
        selectMaskSegment(null);
      }}
      onDone={() => selectMaskSegment(null)}
    />
  );
}

function TextSelectionOverlay({
  project,
  selectedTextSegmentId,
  selectTextSegment,
  updateTextSegment,
  deleteTextSegment,
}: TextSelectionOverlayProps) {
  const textSelection = getSelectedTextSegmentEntry(project, selectedTextSegmentId);
  if (!textSelection) return null;

  return (
    <TextSegmentConfig
      segment={textSelection.segment}
      onUpdate={(updates) => updateTextSegment(textSelection.id, updates)}
      onDelete={() => {
        deleteTextSegment(textSelection.id);
        selectTextSegment(null);
      }}
      onDone={() => selectTextSegment(null)}
    />
  );
}

function SelectionOverlay({
  project,
  selectedZoomRegionId,
  selectedSceneSegmentId,
  selectedAnnotationSegmentId,
  selectedAnnotationShapeId,
  selectedMaskSegmentId,
  selectedTextSegmentId,
  selectZoomRegion,
  selectSceneSegment,
  selectAnnotationSegment,
  selectAnnotationShape,
  selectMaskSegment,
  selectTextSegment,
  updateZoomRegion,
  updateSceneSegment,
  updateMaskSegment,
  updateTextSegment,
  addAnnotationShape,
  updateAnnotationShape,
  reorderAnnotationShape,
  deleteZoomRegion,
  deleteSceneSegment,
  deleteAnnotationSegment,
  deleteAnnotationShape,
  deleteMaskSegment,
  deleteTextSegment,
}: SelectionOverlayProps) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.div
      className="video-sidebar-scroll-area video-sidebar-selection-overlay absolute inset-0 min-w-0 overflow-y-auto p-4 z-20"
      initial={shouldReduceMotion ? false : SELECTION_OVERLAY_INITIAL}
      animate={SELECTION_OVERLAY_ANIMATE}
      exit={shouldReduceMotion ? undefined : SELECTION_OVERLAY_EXIT}
      transition={
        shouldReduceMotion
          ? SELECTION_OVERLAY_REDUCED_TRANSITION
          : SELECTION_OVERLAY_TRANSITION
      }
    >
      <ZoomSelectionOverlay
        project={project}
        selectedZoomRegionId={selectedZoomRegionId}
        selectZoomRegion={selectZoomRegion}
        updateZoomRegion={updateZoomRegion}
        deleteZoomRegion={deleteZoomRegion}
      />

      <SceneSegmentOverlay
        project={project}
        selectedSceneSegmentId={selectedSceneSegmentId}
        selectSceneSegment={selectSceneSegment}
        updateSceneSegment={updateSceneSegment}
        deleteSceneSegment={deleteSceneSegment}
      />

      <AnnotationSelectionOverlay
        project={project}
        selectedAnnotationSegmentId={selectedAnnotationSegmentId}
        selectedAnnotationShapeId={selectedAnnotationShapeId}
        selectAnnotationSegment={selectAnnotationSegment}
        selectAnnotationShape={selectAnnotationShape}
        addAnnotationShape={addAnnotationShape}
        updateAnnotationShape={updateAnnotationShape}
        reorderAnnotationShape={reorderAnnotationShape}
        deleteAnnotationSegment={deleteAnnotationSegment}
        deleteAnnotationShape={deleteAnnotationShape}
      />

      <MaskSelectionOverlay
        project={project}
        selectedMaskSegmentId={selectedMaskSegmentId}
        selectMaskSegment={selectMaskSegment}
        updateMaskSegment={updateMaskSegment}
        deleteMaskSegment={deleteMaskSegment}
      />

      <TextSelectionOverlay
        project={project}
        selectedTextSegmentId={selectedTextSegmentId}
        selectTextSegment={selectTextSegment}
        updateTextSegment={updateTextSegment}
        deleteTextSegment={deleteTextSegment}
      />
    </motion.div>
  );
}

function hasSidebarSelection(selectionIds: Array<string | null>) {
  return selectionIds.some(Boolean);
}

interface ClearSidebarSelectionOptions {
  selectedZoomRegionId: string | null;
  selectedSceneSegmentId: string | null;
  selectedAnnotationSegmentId: string | null;
  selectedMaskSegmentId: string | null;
  selectedTextSegmentId: string | null;
  selectZoomRegion: (id: string | null) => void;
  selectSceneSegment: (id: string | null) => void;
  selectAnnotationSegment: (id: string | null) => void;
  selectMaskSegment: (id: string | null) => void;
  selectTextSegment: (id: string | null) => void;
}

function clearSelectedSidebarEntry(
  selectedId: string | null,
  clearSelection: (id: string | null) => void
) {
  if (selectedId) {
    clearSelection(null);
  }
}

function clearSidebarSelection({
  selectedZoomRegionId,
  selectedSceneSegmentId,
  selectedAnnotationSegmentId,
  selectedMaskSegmentId,
  selectedTextSegmentId,
  selectZoomRegion,
  selectSceneSegment,
  selectAnnotationSegment,
  selectMaskSegment,
  selectTextSegment,
}: ClearSidebarSelectionOptions) {
  const selectionClearers: Array<[string | null, (id: string | null) => void]> = [
    [selectedZoomRegionId, selectZoomRegion],
    [selectedSceneSegmentId, selectSceneSegment],
    [selectedAnnotationSegmentId, selectAnnotationSegment],
    [selectedMaskSegmentId, selectMaskSegment],
    [selectedTextSegmentId, selectTextSegment],
  ];

  selectionClearers.forEach(([selectedId, clearSelection]) => {
    clearSelectedSidebarEntry(selectedId, clearSelection);
  });
}

interface SidebarTabContentProps {
  activeTab: PropertiesTab;
  project: VideoProject | null;
  updateCursorConfig: CursorConfigUpdater;
  updateWebcamConfig: WebcamConfigUpdater;
  updateAudioConfig: AudioConfigUpdater;
  updateExportConfig: ExportConfigUpdater;
}

type SidebarTabRenderer = (props: Omit<SidebarTabContentProps, 'activeTab'>) => React.ReactNode;

function CaptionsTabContent({ project }: Omit<SidebarTabContentProps, 'activeTab'>) {
  return (
    <div className="p-4">
      <CaptionPanel videoPath={project?.sources.screenVideo || null} />
    </div>
  );
}

function StyleTabContent({
  project,
  updateCursorConfig,
  updateWebcamConfig,
}: Omit<SidebarTabContentProps, 'activeTab'>) {
  if (!project) {
    return null;
  }

  return (
    <div className="min-w-0 p-4">
      <div className="video-sidebar-section-stack">
        {project.sources.cursorData && (
          <SidebarSettingsSection
            title="Cursor"
            icon={<MousePointer2 className="h-3.5 w-3.5" />}
            defaultOpen
            variant="flat"
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
            icon={<Video className="h-3.5 w-3.5" />}
            defaultOpen={!project.sources.cursorData}
            variant="flat"
          >
            <WebcamConfigPanel
              project={project}
              onUpdateWebcamConfig={updateWebcamConfig}
            />
          </SidebarSettingsSection>
        )}
      </div>
    </div>
  );
}

function AudioTabContent({
  project,
  updateAudioConfig,
}: Omit<SidebarTabContentProps, 'activeTab'>) {
  if (!project) {
    return null;
  }

  return (
    <div className="min-w-0 p-4">
      <AudioControlsPanel
        project={project}
        onUpdateAudioConfig={updateAudioConfig}
      />
    </div>
  );
}

function BackgroundTabContent({
  project,
  updateExportConfig,
}: Omit<SidebarTabContentProps, 'activeTab'>) {
  if (!project) {
    return null;
  }

  return (
    <div className="min-w-0 p-4">
      <BackgroundSettings
        background={project.export.background}
        onUpdate={(updates) => updateExportConfig({
          background: { ...project.export.background, ...updates }
        })}
      />
    </div>
  );
}

const SIDEBAR_TAB_RENDERERS: Record<PropertiesTab, SidebarTabRenderer> = {
  captions: CaptionsTabContent,
  style: StyleTabContent,
  audio: AudioTabContent,
  background: BackgroundTabContent,
};

function SidebarTabContent({ activeTab, ...props }: SidebarTabContentProps) {
  const renderTab = SIDEBAR_TAB_RENDERERS[activeTab];

  return (
    <div className="video-sidebar-scroll-area h-full min-w-0 overflow-y-auto">
      {renderTab(props)}
    </div>
  );
}

export function VideoEditorSidebar({ project }: VideoEditorSidebarProps) {
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
  const reorderAnnotationShape = useVideoEditorStore(selectReorderAnnotationShape);
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

  const [activeTab, setActiveTab] = useState<PropertiesTab>('style');

  // Clicking a sidebar tab dismisses any open segment properties overlay
  const handleTabChange = useCallback((tab: PropertiesTab) => {
    clearSidebarSelection({
      selectedZoomRegionId,
      selectedSceneSegmentId,
      selectedAnnotationSegmentId,
      selectedMaskSegmentId,
      selectedTextSegmentId,
      selectZoomRegion,
      selectSceneSegment,
      selectAnnotationSegment,
      selectMaskSegment,
      selectTextSegment,
    });
    setActiveTab(tab);
  }, [
    selectedZoomRegionId,
    selectedSceneSegmentId,
    selectedAnnotationSegmentId,
    selectedMaskSegmentId,
    selectedTextSegmentId,
    selectZoomRegion,
    selectSceneSegment,
    selectAnnotationSegment,
    selectMaskSegment,
    selectTextSegment,
  ]);

  // Check if any segment is selected for overlay display
  const hasSelectedSegment = hasSidebarSelection([
    selectedZoomRegionId,
    selectedSceneSegmentId,
    selectedAnnotationSegmentId,
    selectedMaskSegmentId,
    selectedTextSegmentId,
  ]);

  return (
    <div className="compositor-sidebar relative flex h-full w-full flex-col">
      {/* Tab Bar */}
      <SidebarTabBar
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Tab Content */}
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false}>
          {hasSelectedSegment && project && (
            <SelectionOverlay
              key="selection-overlay"
              project={project}
              selectedZoomRegionId={selectedZoomRegionId}
              selectedSceneSegmentId={selectedSceneSegmentId}
              selectedAnnotationSegmentId={selectedAnnotationSegmentId}
              selectedAnnotationShapeId={selectedAnnotationShapeId}
              selectedMaskSegmentId={selectedMaskSegmentId}
              selectedTextSegmentId={selectedTextSegmentId}
              selectZoomRegion={selectZoomRegion}
              selectSceneSegment={selectSceneSegment}
              selectAnnotationSegment={selectAnnotationSegment}
              selectAnnotationShape={selectAnnotationShape}
              selectMaskSegment={selectMaskSegment}
              selectTextSegment={selectTextSegment}
              updateZoomRegion={updateZoomRegion}
              updateSceneSegment={updateSceneSegment}
              updateMaskSegment={updateMaskSegment}
              updateTextSegment={updateTextSegment}
              addAnnotationShape={addAnnotationShape}
              updateAnnotationShape={updateAnnotationShape}
              reorderAnnotationShape={reorderAnnotationShape}
              deleteZoomRegion={deleteZoomRegion}
              deleteSceneSegment={deleteSceneSegment}
              deleteAnnotationSegment={deleteAnnotationSegment}
              deleteAnnotationShape={deleteAnnotationShape}
              deleteMaskSegment={deleteMaskSegment}
              deleteTextSegment={deleteTextSegment}
            />
          )}
        </AnimatePresence>
        <SidebarTabContent
          activeTab={activeTab}
          project={project}
          updateCursorConfig={updateCursorConfig}
          updateWebcamConfig={updateWebcamConfig}
          updateAudioConfig={updateAudioConfig}
          updateExportConfig={updateExportConfig}
        />
      </div>
    </div>
  );
}
