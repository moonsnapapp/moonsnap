import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FolderInput } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { isToday, isYesterday, isThisWeek, isThisMonth, isThisYear, format, formatDistanceToNow } from 'date-fns';
import { reportError } from '../../utils/errorReporting';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useCaptureStore, useFilteredCaptures, useAllTags } from '../../stores/captureStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useCaptureSettingsStore } from '../../stores/captureSettingsStore';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { selectProject as selectVideoProject } from '../../stores/videoEditor/selectors';
import { CaptureService } from '../../services/captureService';
import type { CaptureListItem } from '../../types';
import { LAYOUT, TIMING } from '../../constants';
import { isTextInputTarget } from '../../utils/keyboard';

import { useMarqueeSelection, useDragDropImport, useDragToFolder, useMomentumScroll, useResizeTransitionLock, ROOT_DROP_TARGET_KEY, type VirtualLayoutInfo } from './hooks';
import {
  getColumnsForWidth,
  calculateRowHeight,
  getCardWidth,
  getGridGap,
  getGridWidth,
  getInitialGridContainerWidth,
} from './VirtualizedGrid';
import {
  Library,
  type DateGroup,
  type DeleteDialogState,
  type LibraryCompositionContextValue,
  type LibraryGridLayout,
  type LibraryVariant,
} from './CaptureLibraryComposition';
import { FolderSidebar } from './components/FolderSidebar';
import { NewFolderDialog } from './components/NewFolderDialog';

// VirtualizedGrid positioning offsets (from `top: virtualRow.start + 32` and `px-8`)
const CONTENT_OFFSET_Y = 32; // vertical offset from inline positioning style
const CONTENT_OFFSET_X = 32; // horizontal padding (px-8) on virtual items
const SIDEBAR_CONTENT_OFFSET = 0;
const FULL_VIRTUALIZATION_THRESHOLD = 100;
const SIDEBAR_VIRTUALIZATION_THRESHOLD = 40;
function normalizeMediaPath(path: string | null | undefined): string {
  return (path ?? '').replace(/\\/g, '/').toLowerCase();
}

function isEditableMediaCapture(capture: CaptureListItem): boolean {
  return capture.capture_type !== 'gif' && !capture.is_missing && !capture.damaged;
}

type SaveCaptureFormat = 'png' | 'jpg' | 'webp' | 'gif' | 'mp4';
type VideoProject = ReturnType<typeof useVideoEditorStore.getState>['project'];
type SingleDeleteDialogState = Extract<NonNullable<DeleteDialogState>, { type: 'single' }>;
type DeletePlan =
  | { kind: 'bulk'; ids: string[]; deletedIds: Set<string>; successMessage: string }
  | { kind: 'single'; id: string; deletedIds: Set<string>; successMessage: string };

const SAVE_CAPTURE_FORMATS: Record<SaveCaptureFormat, {
  ext: SaveCaptureFormat;
  name: string;
  extensions: string[];
}> = {
  png: { ext: 'png', name: 'PNG', extensions: ['png'] },
  jpg: { ext: 'jpg', name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  webp: { ext: 'webp', name: 'WebP', extensions: ['webp'] },
  gif: { ext: 'gif', name: 'GIF', extensions: ['gif'] },
  mp4: { ext: 'mp4', name: 'Video', extensions: ['mp4'] },
};

function getCaptureSaveFormat(capture: CaptureListItem): typeof SAVE_CAPTURE_FORMATS[SaveCaptureFormat] {
  if (capture.capture_type === 'gif') {
    return SAVE_CAPTURE_FORMATS.gif;
  }

  if (capture.capture_type === 'video') {
    return SAVE_CAPTURE_FORMATS.mp4;
  }

  return SAVE_CAPTURE_FORMATS.png;
}

function getSaveAsDialogFilters(capture: CaptureListItem) {
  if (capture.capture_type === 'gif') {
    return [SAVE_CAPTURE_FORMATS.gif];
  }

  if (capture.capture_type === 'video') {
    return [SAVE_CAPTURE_FORMATS.mp4];
  }

  return [
    SAVE_CAPTURE_FORMATS.png,
    SAVE_CAPTURE_FORMATS.jpg,
    SAVE_CAPTURE_FORMATS.webp,
  ];
}

function replaceFileExtension(fileName: string, extension: string): string {
  const normalizedExtension = extension.startsWith('.') ? extension.slice(1) : extension;
  const baseName = fileName.replace(/\.[^.\\/]+$/, '');
  return `${baseName}.${normalizedExtension}`;
}

const SAVE_FORMAT_BY_EXTENSION: Partial<Record<string, SaveCaptureFormat>> = {
  jpg: 'jpg',
  jpeg: 'jpg',
  webp: 'webp',
  gif: 'gif',
  mp4: 'mp4',
  png: 'png',
};

function getFileExtension(filePath: string) {
  return filePath.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase();
}

function getSaveAsFormatFromPath(filePath: string, fallback: SaveCaptureFormat): SaveCaptureFormat {
  return SAVE_FORMAT_BY_EXTENSION[getFileExtension(filePath) ?? ''] ?? fallback;
}

function getDefaultSaveCopyPath(capture: CaptureListItem) {
  const saveFormat = getCaptureSaveFormat(capture);
  const originalName = capture.image_path.replace(/\\/g, '/').split('/').pop() || `capture.${saveFormat.ext}`;
  return replaceFileExtension(originalName, saveFormat.ext);
}

async function getSaveCopyDestination(capture: CaptureListItem) {
  return saveFileDialog({
    title: 'Save As',
    defaultPath: getDefaultSaveCopyPath(capture),
    filters: getSaveAsDialogFilters(capture).map((format) => ({
      name: format.name,
      extensions: format.extensions,
    })),
  });
}

function isImageCapture(capture: CaptureListItem): boolean {
  return capture.capture_type !== 'video' && capture.capture_type !== 'gif';
}

async function saveCaptureCopy(capture: CaptureListItem, destination: string) {
  if (isImageCapture(capture)) {
    await invoke('save_image_as_format', {
      sourcePath: capture.image_path,
      destinationPath: destination,
      format: getSaveAsFormatFromPath(destination, 'png'),
    });
    return;
  }

  await invoke('save_copy_of_file', {
    sourcePath: capture.image_path,
    destinationPath: destination,
  });
}

function getOpenableCapture(captures: CaptureListItem[], id: string): CaptureListItem | null {
  const capture = captures.find((candidate) => candidate.id === id);
  if (!capture || capture.is_missing) {
    return null;
  }

  return capture;
}

async function openCaptureInEditor({
  capture,
  handleEditImage,
  handleEditVideo,
  handleEditGif,
}: {
  capture: CaptureListItem;
  handleEditImage: (capture: CaptureListItem) => Promise<void>;
  handleEditVideo: (capture: CaptureListItem) => Promise<void>;
  handleEditGif: (capture: CaptureListItem) => Promise<void>;
}) {
  if (capture.capture_type === 'video') {
    await handleEditVideo(capture);
    return;
  }

  if (capture.capture_type === 'gif') {
    await handleEditGif(capture);
    return;
  }

  await handleEditImage(capture);
}

function getBulkDeletePlan(selectedIds: Set<string>): DeletePlan {
  const ids = Array.from(selectedIds);
  return {
    kind: 'bulk',
    ids,
    deletedIds: new Set(ids),
    successMessage: `Deleted ${ids.length} capture${ids.length > 1 ? 's' : ''}`,
  };
}

function getSingleDeletePlan(id: string): DeletePlan {
  return {
    kind: 'single',
    id,
    deletedIds: new Set([id]),
    successMessage: 'Capture deleted',
  };
}

function getDeletePlan(
  deleteDialog: DeleteDialogState,
  selectedIds: Set<string>
): DeletePlan | null {
  if (!deleteDialog) {
    return null;
  }

  const deletePlanByType = {
    bulk: () => getBulkDeletePlan(selectedIds),
    single: () => getSingleDeletePlan((deleteDialog as SingleDeleteDialogState).id),
  };
  return deletePlanByType[deleteDialog.type]();
}

interface CaptureLibraryProps {
  variant?: LibraryVariant;
  enableKeyboardShortcuts?: boolean;
  focusedCaptureId?: string | null;
  focusRequestKey?: number;
  onFocusCaptureHandled?: () => void;
  onEditImage?: (capture: CaptureListItem) => void | Promise<void>;
  onEditVideo?: (capture: CaptureListItem) => void | Promise<void>;
  onEditGif?: (capture: CaptureListItem) => void | Promise<void>;
}

// Date label rules in priority order (first match wins)
const dateLabelRules: { check: (d: Date) => boolean; label: string | ((d: Date) => string) }[] = [
  { check: isToday, label: 'Today' },
  { check: isYesterday, label: 'Yesterday' },
  { check: (d) => isThisWeek(d, { weekStartsOn: 1 }), label: 'This Week' },
  { check: isThisMonth, label: 'This Month' },
  { check: isThisYear, label: (d) => format(d, 'MMMM') },
];

function getDateLabel(date: Date): string {
  for (const rule of dateLabelRules) {
    if (rule.check(date)) {
      return typeof rule.label === 'function' ? rule.label(date) : rule.label;
    }
  }
  return format(date, 'MMMM yyyy');
}

// Group captures by date periods
function groupCapturesByDate(captures: CaptureListItem[]): DateGroup[] {
  const groups: Map<string, CaptureListItem[]> = new Map();
  const groupOrder: string[] = [];

  // Sort captures by created_at descending first
  const sorted = [...captures].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  for (const capture of sorted) {
    const label = getDateLabel(new Date(capture.created_at));

    if (!groups.has(label)) {
      groups.set(label, []);
      groupOrder.push(label);
    }
    groups.get(label)!.push(capture);
  }

  return groupOrder.map((label) => ({
    label,
    captures: groups.get(label)!,
  }));
}

function getEditorActiveCaptureId(currentProjectId: string | null | undefined) {
  return currentProjectId ?? null;
}

function getVideoEditorActiveCaptureId(
  videoProject: NonNullable<VideoProject>,
  captures: CaptureListItem[]
) {
  const screenVideoPath = normalizeMediaPath(videoProject.sources.screenVideo);
  return captures.find((capture) =>
    capture.id === videoProject.id ||
    normalizeMediaPath(capture.image_path) === screenVideoPath
  )?.id ?? null;
}

function getActiveCaptureId({
  view,
  currentProjectId,
  videoProject,
  captures,
}: {
  view: string;
  currentProjectId: string | null | undefined;
  videoProject: VideoProject;
  captures: CaptureListItem[];
}): string | null {
  if (view === 'editor') {
    return getEditorActiveCaptureId(currentProjectId);
  }

  if (view !== 'videoEditor' || !videoProject) {
    return null;
  }

  return getVideoEditorActiveCaptureId(videoProject, captures);
}

function getVirtualizationThreshold(variant: LibraryVariant): number {
  return variant === 'sidebar' ? SIDEBAR_VIRTUALIZATION_THRESHOLD : FULL_VIRTUALIZATION_THRESHOLD;
}

function getActiveSidebarItemSize(variant: LibraryVariant): number | undefined {
  return variant === 'sidebar' ? LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MIN : undefined;
}

function shouldUseCaptureVirtualization(captureCount: number, variant: LibraryVariant): boolean {
  return captureCount > getVirtualizationThreshold(variant);
}

function hasLibraryActiveFilters({
  filterFavorites,
  filterTags,
  filterMediaTypes,
  searchQuery,
}: {
  filterFavorites: boolean;
  filterTags: unknown[];
  filterMediaTypes: unknown[];
  searchQuery: string;
}): boolean {
  return getActiveFilterCount({
    filterFavorites,
    filterTags,
    filterMediaTypes,
    searchQuery,
  }) > 0;
}

function isDeleteSelectionShortcut(event: KeyboardEvent, selectedCount: number) {
  return selectedCount > 0 && (event.key === 'Delete' || event.key === 'Backspace');
}

function isClearSelectionShortcut(event: KeyboardEvent, selectedCount: number) {
  return selectedCount > 0 && event.key === 'Escape';
}

async function executeDeletePlan({
  deletePlan,
  deleteCaptures,
  deleteCapture,
  setSelectedIds,
}: {
  deletePlan: NonNullable<DeletePlan>;
  deleteCaptures: (ids: string[]) => Promise<void>;
  deleteCapture: (id: string) => Promise<void>;
  setSelectedIds: (ids: Set<string>) => void;
}) {
  if (deletePlan.kind === 'bulk') {
    await deleteCaptures(deletePlan.ids);
    setSelectedIds(new Set());
    return;
  }

  await deleteCapture(deletePlan.id);
}

async function reopenAfterActiveCaptureDelete({
  shouldClearActiveEditor,
  postDeleteTarget,
  clearActiveEditor,
  handleOpenProject,
}: {
  shouldClearActiveEditor: boolean;
  postDeleteTarget: CaptureListItem | null;
  clearActiveEditor: () => void;
  handleOpenProject: (id: string) => Promise<void>;
}) {
  if (!shouldClearActiveEditor) return;

  clearActiveEditor();
  if (postDeleteTarget) {
    await handleOpenProject(postDeleteTarget.id);
  }
}

function getSortedNavigableCaptures(captures: CaptureListItem[]): CaptureListItem[] {
  return captures
    .filter(isEditableMediaCapture)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

function findPostDeleteCapture(
  captures: CaptureListItem[],
  activeIndex: number,
  deletedIds: Set<string>
): CaptureListItem | null {
  const afterActiveCapture = captures
    .slice(activeIndex + 1)
    .find((capture) => !deletedIds.has(capture.id));

  return afterActiveCapture
    ?? captures.slice(0, activeIndex).reverse().find((capture) => !deletedIds.has(capture.id))
    ?? null;
}

function getVirtualLayoutMetrics({
  containerWidth,
  libraryItemScale,
  activeSidebarItemSize,
  variant,
}: {
  containerWidth: number;
  libraryItemScale: number;
  activeSidebarItemSize: number | undefined;
  variant: LibraryVariant;
}) {
  const cardsPerRow = getColumnsForWidth(containerWidth, variant, libraryItemScale, activeSidebarItemSize);
  const cardWidth = getCardWidth(
    containerWidth,
    cardsPerRow,
    variant,
    libraryItemScale,
    activeSidebarItemSize
  );
  const gridRowHeight = calculateRowHeight(
    containerWidth,
    cardsPerRow,
    variant,
    libraryItemScale,
    activeSidebarItemSize
  );
  const gridWidth = getGridWidth(
    containerWidth,
    cardsPerRow,
    variant,
    libraryItemScale,
    activeSidebarItemSize
  );

  return { cardsPerRow, cardWidth, gridRowHeight, gridWidth };
}

function getVirtualContentOffset(variant: LibraryVariant) {
  return variant === 'sidebar' ? SIDEBAR_CONTENT_OFFSET : CONTENT_OFFSET_Y;
}

function getVirtualContentOffsetX(variant: LibraryVariant) {
  return variant === 'sidebar' ? SIDEBAR_CONTENT_OFFSET : CONTENT_OFFSET_X;
}

function getVirtualContainerWidth(
  variant: LibraryVariant,
  gridWidth: number,
  containerWidth: number
) {
  return variant === 'sidebar' ? gridWidth : containerWidth;
}

function getVirtualLayout({
  useVirtualization,
  containerWidth,
  dateGroups,
  libraryItemScale,
  activeSidebarItemSize,
  variant,
}: {
  useVirtualization: boolean;
  containerWidth: number;
  dateGroups: DateGroup[];
  libraryItemScale: number;
  activeSidebarItemSize: number | undefined;
  variant: LibraryVariant;
}): VirtualLayoutInfo | undefined {
  if (!useVirtualization || containerWidth === 0) return undefined;

  const { cardsPerRow, cardWidth, gridRowHeight, gridWidth } = getVirtualLayoutMetrics({
    containerWidth,
    libraryItemScale,
    variant,
    activeSidebarItemSize,
  });

  return {
    cardsPerRow,
    gridRowHeight,
    cardWidth,
    headerHeight: LAYOUT.HEADER_HEIGHT,
    gridGap: getGridGap(variant),
    contentOffsetY: getVirtualContentOffset(variant),
    contentOffsetX: getVirtualContentOffsetX(variant),
    gridWidth,
    containerWidth: getVirtualContainerWidth(variant, gridWidth, containerWidth),
    dateGroups,
  };
}

function getLibraryGridLayout({
  containerWidth,
  variant,
  libraryItemScale,
  activeSidebarItemSize,
}: {
  containerWidth: number;
  variant: LibraryVariant;
  libraryItemScale: number;
  activeSidebarItemSize: number | undefined;
}): LibraryGridLayout {
  const width = containerWidth || getInitialGridContainerWidth(variant, activeSidebarItemSize);
  const columns = getColumnsForWidth(width, variant, libraryItemScale, activeSidebarItemSize);
  const gap = getGridGap(variant);
  const cardWidth = getCardWidth(width, columns, variant, libraryItemScale, activeSidebarItemSize);

  return {
    gap,
    maxWidth: getGridWidth(width, columns, variant, libraryItemScale, activeSidebarItemSize),
    gridTemplateColumns: `repeat(${columns}, minmax(0, ${cardWidth}px))`,
    justifyContent: variant === 'sidebar' ? 'start' : 'center',
  };
}

function getActiveFilterCount({
  filterFavorites,
  filterTags,
  filterMediaTypes,
  searchQuery,
}: {
  filterFavorites: boolean;
  filterTags: unknown[];
  filterMediaTypes: unknown[];
  searchQuery: string;
}): number {
  return (
    (filterFavorites ? 1 : 0) +
    filterTags.length +
    filterMediaTypes.length +
    (searchQuery ? 1 : 0)
  );
}

function getDeleteCount(deleteDialog: DeleteDialogState, selectedIds: Set<string>): number {
  if (!deleteDialog) {
    return 0;
  }

  const deleteCountByType = {
    bulk: selectedIds.size,
    single: 1,
  };
  return deleteCountByType[deleteDialog.type];
}

function getCaptureCardElement(
  container: HTMLElement,
  captureId: string
): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-capture-id="${CSS.escape(captureId)}"]`);
}

function scrollCaptureCardIntoView(card: HTMLElement): void {
  card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
}

function scrollVirtualCaptureIntoView({
  container,
  rowTop,
  gridRowHeight,
}: {
  container: HTMLElement;
  rowTop: number;
  gridRowHeight: number;
}): void {
  container.scrollTo({
    top: Math.max(0, rowTop - (container.clientHeight / 2) + gridRowHeight / 2),
    behavior: 'smooth',
  });
}

function getCaptureRowIndexInGroup(
  group: DateGroup,
  captureId: string,
  cardsPerRow: number
): number | null {
  for (let startIndex = 0; startIndex < group.captures.length; startIndex += cardsPerRow) {
    const rowCaptures = group.captures.slice(startIndex, startIndex + cardsPerRow);
    if (rowCaptures.some((capture) => capture.id === captureId)) {
      return startIndex / cardsPerRow;
    }
  }

  return null;
}

function getDateGroupRowsHeight(group: DateGroup, virtualLayout: VirtualLayoutInfo): number {
  const rowCount = Math.ceil(group.captures.length / virtualLayout.cardsPerRow);
  return rowCount * virtualLayout.gridRowHeight;
}

function getVirtualCaptureScrollTop({
  dateGroups,
  captureId,
  virtualLayout,
}: {
  dateGroups: DateGroup[];
  captureId: string;
  virtualLayout: VirtualLayoutInfo;
}): number | null {
  let rowTop = 0;

  for (const group of dateGroups) {
    rowTop += virtualLayout.headerHeight;
    const rowIndex = getCaptureRowIndexInGroup(group, captureId, virtualLayout.cardsPerRow);
    if (rowIndex !== null) {
      return rowTop + rowIndex * virtualLayout.gridRowHeight;
    }

    rowTop += getDateGroupRowsHeight(group, virtualLayout);
  }

  return null;
}

function getVideoProjectFolderPath(imagePath: string): string {
  const sep = imagePath.includes('\\') ? '\\' : '/';
  const parts = imagePath.split(/[/\\]/);
  return parts.length > 1 ? parts.slice(0, -1).join(sep) : imagePath;
}

function getRevealPathForCapture(capture: CaptureListItem): string {
  if (capture.capture_type === 'video' && !capture.quick_capture) {
    return getVideoProjectFolderPath(capture.image_path);
  }

  return capture.image_path;
}

function scrollFocusedCaptureIntoView({
  container,
  captureId,
  getCaptureScrollTop,
  gridRowHeight,
}: {
  container: HTMLElement;
  captureId: string;
  getCaptureScrollTop: (captureId: string) => number | null;
  gridRowHeight: number;
}): void {
  const card = getCaptureCardElement(container, captureId);
  if (card) {
    scrollCaptureCardIntoView(card);
    return;
  }

  const rowTop = getCaptureScrollTop(captureId);
  if (rowTop === null) {
    return;
  }

  scrollVirtualCaptureIntoView({ container, rowTop, gridRowHeight });
}

export const CaptureLibrary: React.FC<CaptureLibraryProps> = ({
  variant = 'full',
  enableKeyboardShortcuts = true,
  focusedCaptureId = null,
  focusRequestKey = 0,
  onFocusCaptureHandled,
  onEditImage,
  onEditVideo,
  onEditGif,
}) => {
  const {
    loading,
    initialized,
    loadingProjectId,
    loadCaptures,
    deleteCapture,
    deleteCaptures,
    currentProject,
    view,
    setCurrentProject,
    setCurrentImageData,
    setView,
    toggleFavorite,
    updateTags,
    searchQuery,
    setSearchQuery,
    filterFavorites,
    setFilterFavorites,
    filterTags,
    setFilterTags,
    filterMediaTypes,
    setFilterMediaTypes,
    libraryItemScale,
    setLibraryItemScale,
    folders,
    activeFolderId,
    setActiveFolder,
    loadFolders,
    moveCapturesToFolder,
  } = useCaptureStore();

  const { settings } = useSettingsStore();
  const videoProject = useVideoEditorStore(selectVideoProject);

  const totalCaptureCount = useCaptureStore((state) => state.captures.length);
  const captures = useFilteredCaptures();
  const allTags = useAllTags();
  const hasActiveFilters = hasLibraryActiveFilters({
    filterFavorites,
    filterTags,
    filterMediaTypes,
    searchQuery,
  });
  const activeCaptureId = useMemo(
    () => getActiveCaptureId({
      view,
      currentProjectId: currentProject?.id,
      videoProject,
      captures,
    }),
    [captures, currentProject?.id, videoProject, view]
  );

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setFilterFavorites(false);
    setFilterTags([]);
    setFilterMediaTypes([]);
  }, [setSearchQuery, setFilterFavorites, setFilterTags, setFilterMediaTypes]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Use virtualization for large libraries. Sidebar mode uses the same
  // renderer in a compact one-column layout so expand/collapse doesn't remount
  // a long list of capture cards.
  const useVirtualization = shouldUseCaptureVirtualization(captures.length, variant);

  // Track container width for grid and virtual layout calculations (debounced for performance)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || captures.length === 0) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const updateWidth = () => setContainerWidth(container.clientWidth);
    updateWidth();

    const resizeObserver = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateWidth, TIMING.RESIZE_DEBOUNCE_MS);
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [captures.length, useVirtualization]);

  // Compute date groups
  const dateGroups = useMemo(() => groupCapturesByDate(captures), [captures]);

  // Sidebar always renders at the smallest item size; the density slider has been removed.
  const activeSidebarItemSize = getActiveSidebarItemSize(variant);

  const virtualLayout = useMemo<VirtualLayoutInfo | undefined>(() => {
    return getVirtualLayout({
      useVirtualization,
      containerWidth,
      dateGroups,
      libraryItemScale,
      activeSidebarItemSize,
      variant,
    });
  }, [useVirtualization, containerWidth, dateGroups, libraryItemScale, activeSidebarItemSize, variant]);

  // Delete confirmation state - consolidated into single object
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);

  // Open image in dedicated editor window
  const handleEditImage = useCallback(async (capture: CaptureListItem) => {
    if (onEditImage) {
      await onEditImage(capture);
      return;
    }

    try {
      // Open image in a dedicated floating window
      // If the image is already open, the existing window will be focused
      await invoke('show_image_editor_window', { capturePath: capture.image_path });
    } catch (error) {
      reportError(error, { operation: 'image editor open' });
      toast.error('Failed to open image editor');
    }
  }, [onEditImage]);

  const handleEditVideo = useCallback(async (capture: CaptureListItem) => {
    if (onEditVideo) {
      await onEditVideo(capture);
      return;
    }

    try {
      // Open video in a dedicated floating window
      // If the video is already open, the existing window will be focused
      await invoke('show_video_editor_window', { projectPath: capture.image_path });
    } catch (error) {
      reportError(error, { operation: 'video editor open' });
      toast.error('Failed to open video editor');
    }
  }, [onEditVideo]);

  // Open project in editor window
  const handleEditGif = useCallback(async (capture: CaptureListItem) => {
    if (onEditGif) {
      await onEditGif(capture);
      return;
    }

    try {
      await invoke('show_gif_editor_window', { capturePath: capture.image_path });
    } catch (error) {
      reportError(error, { operation: 'gif editor open' });
      toast.error('Failed to open GIF editor');
    }
  }, [onEditGif]);

  const handleOpenProject = useCallback(async (id: string) => {
    const capture = getOpenableCapture(captures, id);
    if (!capture) {
      return;
    }

    await openCaptureInEditor({
      capture,
      handleEditImage,
      handleEditVideo,
      handleEditGif,
    });
  }, [captures, handleEditImage, handleEditVideo, handleEditGif]);

  const getPostDeleteTarget = useCallback((deletedIds: Set<string>) => {
    if (!activeCaptureId || !deletedIds.has(activeCaptureId)) {
      return null;
    }

    const navigableCaptures = getSortedNavigableCaptures(captures);
    const activeIndex = navigableCaptures.findIndex((capture) => capture.id === activeCaptureId);
    if (activeIndex === -1) {
      return null;
    }

    return findPostDeleteCapture(navigableCaptures, activeIndex, deletedIds);
  }, [activeCaptureId, captures]);

  const clearActiveEditor = useCallback(() => {
    useVideoEditorStore.getState().clearEditor();
    setCurrentProject(null);
    setCurrentImageData(null);
    setView('library');
  }, [setCurrentImageData, setCurrentProject, setView]);

  // Selection hook
  const {
    selectedIds,
    setSelectedIds,
    isSelecting,
    selectionRect,
    handleMarqueeMouseDown,
    handleMarqueeMouseMove,
    handleMarqueeMouseUp,
    handleSelect,
    handleOpen,
    clearSelection,
  } = useMarqueeSelection({
    captures,
    containerRef: containerRef as React.RefObject<HTMLDivElement>,
    onOpenProject: handleOpenProject,
    virtualLayout,
  });

  // Drag & drop hook (uses Tauri's native drag-drop events)
  const { isDragOver } = useDragDropImport({
    onImportComplete: loadCaptures,
  });

  // Memoized cards can hold an older move-to-folder callback; the ref makes
  // sure the handler always sees the current selection.
  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  const moveCapturesWithToast = useCallback(async (ids: string[], folderId: string | null) => {
    try {
      await moveCapturesToFolder(ids, folderId);
      const folderName = folderId
        ? useCaptureStore.getState().folders.find((folder) => folder.id === folderId)?.name
        : null;
      const itemsLabel = ids.length > 1 ? `${ids.length} captures` : 'Capture';
      toast.success(
        folderName ? `${itemsLabel} moved to "${folderName}"` : `${itemsLabel} removed from folder`
      );
    } catch (error) {
      reportError(error, { operation: 'move to folder' });
      toast.error('Failed to move capture');
    }
  }, [moveCapturesToFolder]);

  // Moving a capture that is part of a multi-selection moves the whole selection
  const handleMoveToFolder = useCallback((captureId: string, folderId: string | null) => {
    const selected = selectedIdsRef.current;
    const ids = selected.has(captureId) && selected.size > 1 ? Array.from(selected) : [captureId];
    return moveCapturesWithToast(ids, folderId);
  }, [moveCapturesWithToast]);

  const handleDropToFolder = useCallback((captureIds: string[], targetKey: string) => {
    void moveCapturesWithToast(
      captureIds,
      targetKey === ROOT_DROP_TARGET_KEY ? null : targetKey
    );
  }, [moveCapturesWithToast]);

  // "New Folder…" from the context menu: prompt for a name, then create + move
  const [newFolderCaptureId, setNewFolderCaptureId] = useState<string | null>(null);

  const handleRequestNewFolder = useCallback((captureId: string) => {
    setNewFolderCaptureId(captureId);
  }, []);

  const handleCreateFolderAndMove = useCallback(async (name: string) => {
    const captureId = newFolderCaptureId;
    setNewFolderCaptureId(null);
    if (!captureId) return;

    try {
      const folder = await useCaptureStore.getState().createFolder(name);
      await handleMoveToFolder(captureId, folder.id);
    } catch (error) {
      reportError(error, { operation: 'create folder' });
      toast.error('Failed to create folder');
    }
  }, [newFolderCaptureId, handleMoveToFolder]);

  // Mouse-tracked drag of cards onto the folder rail (full variant only)
  const folderDragState = useDragToFolder({
    containerRef,
    enabled: variant === 'full',
    selectedIdsRef,
    onDrop: handleDropToFolder,
  });

  const handleShowAllItems = useCallback(() => {
    setActiveFolder(null);
  }, [setActiveFolder]);

  const activeFolderName = useMemo(() => {
    if (!activeFolderId) return null;
    return folders.find((folder) => folder.id === activeFolderId)?.name ?? null;
  }, [folders, activeFolderId]);

  const getCaptureScrollTop = useCallback((captureId: string) => {
    if (!virtualLayout) {
      return null;
    }

    return getVirtualCaptureScrollTop({ dateGroups, captureId, virtualLayout });
  }, [dateGroups, virtualLayout]);

  useEffect(() => {
    if (!focusedCaptureId) {
      return;
    }

    setSelectedIds(new Set([focusedCaptureId]));

    requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      scrollFocusedCaptureIntoView({
        container,
        captureId: focusedCaptureId,
        getCaptureScrollTop,
        gridRowHeight: virtualLayout?.gridRowHeight ?? 0,
      });
    });
    onFocusCaptureHandled?.();
  }, [focusedCaptureId, focusRequestKey, getCaptureScrollTop, onFocusCaptureHandled, setSelectedIds, virtualLayout?.gridRowHeight]);

  // Momentum scroll for smooth acceleration (disabled during marquee selection)
  useMomentumScroll(containerRef, { disabled: isSelecting });

  // Disable transitions during window resize for smoother performance
  useResizeTransitionLock();

  useEffect(() => {
    loadCaptures();
  }, [loadCaptures]);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);

  const handleNewImage = async () => {
    // Set active mode so toolbar shows correct mode
    const { setActiveMode } = useCaptureSettingsStore.getState();
    setActiveMode('screenshot');
    await CaptureService.showScreenshotOverlay();
  };

  const handleOpenLibraryFolder = async () => {
    try {
      // Use cached settings from store instead of re-reading from disk
      const libraryPath = settings.general.defaultSaveDir;
      if (!libraryPath) {
        toast.error('No save directory configured');
        return;
      }
      await invoke('open_path_in_explorer', { path: libraryPath });
    } catch (error) {
      reportError(error, { operation: 'folder open' });
    }
  };

  // Delete handlers
  const handleRequestDeleteSingle = useCallback((id: string) => {
    setDeleteDialog({ type: 'single', id });
  }, []);

  const handleRequestDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    setDeleteDialog({ type: 'bulk' });
  }, [selectedIds.size]);

  // Keyboard shortcut for deleting selected captures
  useEffect(() => {
    if (!enableKeyboardShortcuts) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isTextInputTarget(e.target)) {
        return;
      }

      if (isDeleteSelectionShortcut(e, selectedIds.size)) {
        e.preventDefault();
        handleRequestDeleteSelected();
      }

      if (isClearSelectionShortcut(e, selectedIds.size)) {
        e.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardShortcuts, selectedIds.size, handleRequestDeleteSelected, clearSelection]);

  const handleConfirmDelete = async () => {
    const deletePlan = getDeletePlan(deleteDialog, selectedIds);
    if (!deletePlan) {
      setDeleteDialog(null);
      return;
    }

    try {
      const postDeleteTarget = getPostDeleteTarget(deletePlan.deletedIds);
      const shouldClearActiveEditor =
        activeCaptureId !== null && deletePlan.deletedIds.has(activeCaptureId);

      await executeDeletePlan({ deletePlan, deleteCaptures, deleteCapture, setSelectedIds });
      await reopenAfterActiveCaptureDelete({
        shouldClearActiveEditor,
        postDeleteTarget,
        clearActiveEditor,
        handleOpenProject,
      });
      toast.success(deletePlan.successMessage);
    } catch (error) {
      reportError(error, { operation: 'delete capture' });
    }
    setDeleteDialog(null);
  };

  const handleCancelDelete = () => {
    setDeleteDialog(null);
  };

  const handleOpenInFolder = useCallback(async (capture: CaptureListItem) => {
    try {
      const revealPath = getRevealPathForCapture(capture);
      await invoke('reveal_file_in_explorer', { path: revealPath });
    } catch (error) {
      reportError(error, { operation: 'folder open' });
    }
  }, []);

  const handleCopyToClipboard = useCallback(async (capture: CaptureListItem) => {
    try {
      await invoke('copy_image_to_clipboard', { path: capture.image_path });
      toast.success('Copied to clipboard');
    } catch (error) {
      reportError(error, { operation: 'copy to clipboard' });
    }
  }, []);

  const handlePlayMedia = useCallback(async (capture: CaptureListItem) => {
    try {
      await invoke('open_file_with_default_app', { path: capture.image_path });
    } catch (error) {
      reportError(error, { operation: 'media open' });
    }
  }, []);

  const handleRepair = useCallback(async (captureId: string) => {
    try {
      const selected = await openFileDialog({
        title: 'Select video file to repair project',
        filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm'] }],
      });
      if (selected && typeof selected === 'string') {
        await invoke('repair_project', { projectId: captureId, newVideoPath: selected });
        toast.success('Project repaired successfully');
        await loadCaptures();
      }
    } catch (error) {
      reportError(error, { operation: 'repair project' });
      toast.error('Failed to repair project');
    }
  }, [loadCaptures]);

  const handleSaveCopy = useCallback(async (capture: CaptureListItem) => {
    try {
      const destination = await getSaveCopyDestination(capture);
      if (!destination) {
        return;
      }

      await saveCaptureCopy(capture, destination);
      toast.success('Capture saved');
    } catch (error) {
      reportError(error, { operation: 'save as' });
      toast.error('Failed to save capture');
    }
  }, []);

  const formatDate = (dateStr: string) => {
    try {
      return formatDistanceToNow(new Date(dateStr), { addSuffix: true });
    } catch {
      return dateStr;
    }
  };

  const handleLibraryWheel = useCallback(
    (event: WheelEvent) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const direction = Math.sign(event.deltaY);
      if (direction === 0) {
        return;
      }

      if (variant === 'sidebar') {
        return;
      }

      const nextScale = Number((libraryItemScale - direction * LAYOUT.LIBRARY_ITEM_SCALE_STEP).toFixed(2));
      setLibraryItemScale(nextScale);
    },
    [libraryItemScale, setLibraryItemScale, variant]
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('wheel', handleLibraryWheel, {
      capture: true,
      passive: false,
    });

    return () => {
      container.removeEventListener('wheel', handleLibraryWheel, { capture: true });
    };
  }, [handleLibraryWheel, useVirtualization]);

  const gridLayout = useMemo<LibraryGridLayout>(() => {
    return getLibraryGridLayout({
      containerWidth,
      variant,
      libraryItemScale,
      activeSidebarItemSize,
    });
  }, [activeSidebarItemSize, containerWidth, libraryItemScale, variant]);

  const activeFilterCount = getActiveFilterCount({
    filterFavorites,
    filterTags,
    filterMediaTypes,
    searchQuery,
  });

  const libraryComposition: LibraryCompositionContextValue = {
    variant,
    loading,
    initialized,
    captures,
    dateGroups,
    hasActiveFilters,
    totalCaptureCount,
    useVirtualization,
    libraryItemScale,
    activeSidebarItemSize,
    selectedIds,
    isSelecting,
    selectionRect,
    activeCaptureId,
    loadingProjectId,
    allTags,
    filterFavorites,
    filterTags,
    filterMediaTypes,
    searchQuery,
    activeFilterCount,
    activeFolderName,
    deleteDialog,
    deleteCount: getDeleteCount(deleteDialog, selectedIds),
    isDragOver,
    gridLayout,
    containerRef,
    onClearAllFilters: clearAllFilters,
    onNewImage: handleNewImage,
    onSelect: handleSelect,
    onOpen: handleOpen,
    onToggleFavorite: toggleFavorite,
    onUpdateTags: updateTags,
    onRequestDeleteSingle: handleRequestDeleteSingle,
    onRequestDeleteSelected: handleRequestDeleteSelected,
    onClearSelection: clearSelection,
    onOpenInFolder: handleOpenInFolder,
    onCopyToClipboard: handleCopyToClipboard,
    onPlayMedia: handlePlayMedia,
    onEditVideo: handleEditVideo,
    onSaveCopy: handleSaveCopy,
    onRepair: handleRepair,
    onMoveToFolder: handleMoveToFolder,
    onRequestNewFolder: handleRequestNewFolder,
    onShowAllItems: handleShowAllItems,
    onFormatDate: formatDate,
    onMarqueeMouseDown: handleMarqueeMouseDown,
    onMarqueeMouseMove: handleMarqueeMouseMove,
    onMarqueeMouseUp: handleMarqueeMouseUp,
    onDeleteDialogOpenChange: (open) => !open && setDeleteDialog(null),
    onConfirmDelete: handleConfirmDelete,
    onCancelDelete: handleCancelDelete,
    onSearchChange: setSearchQuery,
    onFilterFavoritesChange: setFilterFavorites,
    onFilterTagsChange: setFilterTags,
    onFilterMediaTypesChange: setFilterMediaTypes,
    onOpenLibraryFolder: handleOpenLibraryFolder,
  };

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <div className={`library-panel library-panel--${variant} flex flex-col h-full relative`}>
        <Library.Provider value={libraryComposition}>
          <Library.DropZone />
          <div className="flex flex-1 min-h-0">
            {variant === 'full' && (
              <FolderSidebar dropTargetKey={folderDragState?.targetKey ?? null} />
            )}
            <div className="flex flex-col flex-1 min-w-0">
              <Library.Content />
            </div>
          </div>
          <Library.DeleteDialog />
          <Library.Toolbar />
          <NewFolderDialog
            open={newFolderCaptureId !== null}
            onOpenChange={(open) => !open && setNewFolderCaptureId(null)}
            onCreate={handleCreateFolderAndMove}
          />
        </Library.Provider>
        {folderDragState && createPortal(
          <div
            className="folder-drag-ghost"
            style={{ left: folderDragState.x + 14, top: folderDragState.y + 10 }}
          >
            <FolderInput className="w-3.5 h-3.5" />
            <span>
              Move {folderDragState.captureIds.length > 1
                ? `${folderDragState.captureIds.length} captures`
                : 'capture'}
            </span>
          </div>,
          document.body
        )}
      </div>
    </TooltipProvider>
  );
};
