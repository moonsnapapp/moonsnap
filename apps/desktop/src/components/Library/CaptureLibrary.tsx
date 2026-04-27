import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openFileDialog, save as saveFileDialog } from '@tauri-apps/plugin-dialog';
import { toast } from 'sonner';
import { isToday, isYesterday, isThisWeek, isThisMonth, isThisYear, format, formatDistanceToNow } from 'date-fns';
import { reportError } from '../../utils/errorReporting';
import { Loader2 } from 'lucide-react';
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

import { useMarqueeSelection, useDragDropImport, useMomentumScroll, useResizeTransitionLock, type VirtualLayoutInfo } from './hooks';
// Direct imports avoid barrel file bundling overhead
import { DateHeader } from './components/DateHeader';
import { EmptyState } from './components/EmptyState';
import { DropZoneOverlay } from './components/DropZoneOverlay';
import { CaptureCard } from './components/CaptureCard';
import { GlassBlobToolbar } from './components/GlassBlobToolbar';
import { DeleteDialog } from './components/DeleteDialog';
import { VirtualizedGrid, getColumnsForWidth, calculateRowHeight, getCardWidth, getGridGap, getGridWidth } from './VirtualizedGrid';

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

function getSaveAsFormatFromPath(filePath: string, fallback: SaveCaptureFormat): SaveCaptureFormat {
  const extension = filePath.replace(/\\/g, '/').split('/').pop()?.split('.').pop()?.toLowerCase();

  if (extension === 'jpg' || extension === 'jpeg') {
    return 'jpg';
  }

  if (extension === 'webp') {
    return 'webp';
  }

  if (extension === 'gif') {
    return 'gif';
  }

  if (extension === 'mp4') {
    return 'mp4';
  }

  if (extension === 'png') {
    return 'png';
  }

  return fallback;
}

function isImageCapture(capture: CaptureListItem): boolean {
  return capture.capture_type !== 'video' && capture.capture_type !== 'gif';
}

interface CaptureLibraryProps {
  variant?: 'full' | 'sidebar';
  enableKeyboardShortcuts?: boolean;
  focusedCaptureId?: string | null;
  focusRequestKey?: number;
  onEditImage?: (capture: CaptureListItem) => void | Promise<void>;
  onEditVideo?: (capture: CaptureListItem) => void | Promise<void>;
}

interface DateGroup {
  label: string;
  captures: CaptureListItem[];
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

export const CaptureLibrary: React.FC<CaptureLibraryProps> = ({
  variant = 'full',
  enableKeyboardShortcuts = true,
  focusedCaptureId = null,
  focusRequestKey = 0,
  onEditImage,
  onEditVideo,
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
    librarySidebarItemSize,
    setLibrarySidebarItemSize,
  } = useCaptureStore();

  const { settings } = useSettingsStore();
  const videoProject = useVideoEditorStore(selectVideoProject);

  const totalCaptureCount = useCaptureStore((state) => state.captures.length);
  const captures = useFilteredCaptures();
  const allTags = useAllTags();
  const hasActiveFilters = filterFavorites || filterTags.length > 0 || filterMediaTypes.length > 0 || searchQuery.length > 0;
  const activeCaptureId = useMemo(() => {
    if (view === 'editor') {
      return currentProject?.id ?? null;
    }

    if (view !== 'videoEditor' || !videoProject) {
      return null;
    }

    const screenVideoPath = normalizeMediaPath(videoProject.sources.screenVideo);
    return captures.find((capture) =>
      capture.id === videoProject.id ||
      normalizeMediaPath(capture.image_path) === screenVideoPath
    )?.id ?? null;
  }, [captures, currentProject?.id, videoProject, view]);

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
  const virtualizationThreshold =
    variant === 'sidebar' ? SIDEBAR_VIRTUALIZATION_THRESHOLD : FULL_VIRTUALIZATION_THRESHOLD;
  const useVirtualization = captures.length > virtualizationThreshold;

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

  // Compute virtual layout info for marquee selection
  const activeSidebarItemSize = variant === 'sidebar' ? librarySidebarItemSize : undefined;

  const virtualLayout = useMemo<VirtualLayoutInfo | undefined>(() => {
    if (!useVirtualization || containerWidth === 0) return undefined;

    // Use the same breakpoint-based column calculation as VirtualizedGrid
    const cardsPerRow = getColumnsForWidth(containerWidth, variant, libraryItemScale, activeSidebarItemSize);

    // Use the same card width calculation as VirtualizedGrid (capped at MAX_CARD_WIDTH)
    const cardWidth = getCardWidth(
      containerWidth,
      cardsPerRow,
      variant,
      libraryItemScale,
      activeSidebarItemSize
    );

    // Use dynamic row height calculation matching VirtualizedGrid
    const gridRowHeight = calculateRowHeight(
      containerWidth,
      cardsPerRow,
      variant,
      libraryItemScale,
      activeSidebarItemSize
    );

    // Calculate grid width for centering calculations
    const gridWidth = getGridWidth(
      containerWidth,
      cardsPerRow,
      variant,
      libraryItemScale,
      activeSidebarItemSize
    );

    return {
      cardsPerRow,
      gridRowHeight,
      cardWidth,
      headerHeight: LAYOUT.HEADER_HEIGHT,
      gridGap: getGridGap(variant),
      contentOffsetY: variant === 'sidebar' ? SIDEBAR_CONTENT_OFFSET : CONTENT_OFFSET_Y,
      contentOffsetX: variant === 'sidebar' ? SIDEBAR_CONTENT_OFFSET : CONTENT_OFFSET_X,
      gridWidth,
      containerWidth: variant === 'sidebar' ? gridWidth : containerWidth,
      dateGroups,
    };
  }, [useVirtualization, containerWidth, dateGroups, libraryItemScale, activeSidebarItemSize, variant]);

  // Delete confirmation state - consolidated into single object
  type DeleteDialogState = { type: 'single'; id: string } | { type: 'bulk' } | null;
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
  const handleOpenProject = useCallback(async (id: string) => {
    const capture = captures.find(c => c.id === id);
    if (!capture || capture.is_missing) return;

    if (capture.capture_type === 'video') {
      await handleEditVideo(capture);
      return;
    }

    if (capture.capture_type !== 'gif') {
      await handleEditImage(capture);
    }
  }, [captures, handleEditImage, handleEditVideo]);

  const getPostDeleteTarget = useCallback((deletedIds: Set<string>) => {
    if (!activeCaptureId || !deletedIds.has(activeCaptureId)) {
      return null;
    }

    const navigableCaptures = captures
      .filter(isEditableMediaCapture)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const activeIndex = navigableCaptures.findIndex((capture) => capture.id === activeCaptureId);
    if (activeIndex === -1) {
      return null;
    }

    return (
      navigableCaptures.slice(activeIndex + 1).find((capture) => !deletedIds.has(capture.id)) ??
      navigableCaptures.slice(0, activeIndex).reverse().find((capture) => !deletedIds.has(capture.id)) ??
      null
    );
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

  const getCaptureScrollTop = useCallback((captureId: string) => {
    if (!virtualLayout) {
      return null;
    }

    let rowTop = 0;
    for (const group of dateGroups) {
      rowTop += virtualLayout.headerHeight;
      for (let startIndex = 0; startIndex < group.captures.length; startIndex += virtualLayout.cardsPerRow) {
        const rowCaptures = group.captures.slice(startIndex, startIndex + virtualLayout.cardsPerRow);
        if (rowCaptures.some((capture) => capture.id === captureId)) {
          return rowTop;
        }
        rowTop += virtualLayout.gridRowHeight;
      }
    }

    return null;
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

      const card = container.querySelector<HTMLElement>(`[data-capture-id="${CSS.escape(focusedCaptureId)}"]`);
      if (card) {
        card.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        return;
      }

      const rowTop = getCaptureScrollTop(focusedCaptureId);
      if (rowTop === null) {
        return;
      }

      container.scrollTo({
        top: Math.max(0, rowTop - (container.clientHeight / 2) + (virtualLayout?.gridRowHeight ?? 0) / 2),
        behavior: 'smooth',
      });
    });
  }, [focusedCaptureId, focusRequestKey, getCaptureScrollTop, setSelectedIds, virtualLayout?.gridRowHeight]);

  // Momentum scroll for smooth acceleration (disabled during marquee selection)
  useMomentumScroll(containerRef, { disabled: isSelecting });

  // Disable transitions during window resize for smoother performance
  useResizeTransitionLock();

  useEffect(() => {
    loadCaptures();
  }, [loadCaptures]);

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
      // Don't trigger if typing in an input field
      if (isTextInputTarget(e.target)) {
        return;
      }

      // Delete or Backspace to delete selected captures
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault();
        handleRequestDeleteSelected();
      }

      // Escape to clear selection
      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [enableKeyboardShortcuts, selectedIds.size, handleRequestDeleteSelected, clearSelection]);

  const handleConfirmDelete = async () => {
    try {
      if (deleteDialog?.type === 'bulk') {
        const deletedIds = new Set(selectedIds);
        const postDeleteTarget = getPostDeleteTarget(deletedIds);
        const shouldClearActiveEditor = activeCaptureId !== null && deletedIds.has(activeCaptureId);

        await deleteCaptures(Array.from(deletedIds));
        setSelectedIds(new Set());
        if (shouldClearActiveEditor) {
          clearActiveEditor();
          if (postDeleteTarget) {
            await handleOpenProject(postDeleteTarget.id);
          }
        }
        toast.success(`Deleted ${selectedIds.size} capture${selectedIds.size > 1 ? 's' : ''}`);
      } else if (deleteDialog?.type === 'single') {
        const deletedIds = new Set([deleteDialog.id]);
        const postDeleteTarget = getPostDeleteTarget(deletedIds);
        const shouldClearActiveEditor = activeCaptureId === deleteDialog.id;

        await deleteCapture(deleteDialog.id);
        if (shouldClearActiveEditor) {
          clearActiveEditor();
          if (postDeleteTarget) {
            await handleOpenProject(postDeleteTarget.id);
          }
        }
        toast.success('Capture deleted');
      }
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
      let revealPath = capture.image_path;
      // For video projects, reveal the project folder instead of screen.mp4 inside it
      if (capture.capture_type === 'video' && !capture.quick_capture) {
        const sep = capture.image_path.includes('\\') ? '\\' : '/';
        const parts = capture.image_path.split(/[/\\]/);
        // Remove the filename (screen.mp4) to get the folder path
        if (parts.length > 1) {
          revealPath = parts.slice(0, -1).join(sep);
        }
      }
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
      const saveFormat = getCaptureSaveFormat(capture);
      const originalName = capture.image_path.replace(/\\/g, '/').split('/').pop() || `capture.${saveFormat.ext}`;
      const defaultPath = replaceFileExtension(originalName, saveFormat.ext);
      // Use original filename as default save name
      const destination = await saveFileDialog({
        title: 'Save As',
        defaultPath,
        filters: getSaveAsDialogFilters(capture).map((format) => ({
          name: format.name,
          extensions: format.extensions,
        })),
      });
      if (destination) {
        if (isImageCapture(capture)) {
          await invoke('save_image_as_format', {
            sourcePath: capture.image_path,
            destinationPath: destination,
            format: getSaveAsFormatFromPath(destination, 'png'),
          });
        } else {
          await invoke('save_copy_of_file', {
            sourcePath: capture.image_path,
            destinationPath: destination,
          });
        }
        toast.success('Capture saved');
      }
    } catch (error) {
      reportError(error, { operation: 'save as' });
      toast.error('Failed to save capture');
    }
  }, []);

  const getDeleteCount = () => {
    if (deleteDialog?.type === 'bulk') return selectedIds.size;
    return deleteDialog?.type === 'single' ? 1 : 0;
  };

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
        setLibrarySidebarItemSize(
          librarySidebarItemSize - direction * LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_STEP
        );
        return;
      }

      const nextScale = Number((libraryItemScale - direction * LAYOUT.LIBRARY_ITEM_SCALE_STEP).toFixed(2));
      setLibraryItemScale(nextScale);
    },
    [libraryItemScale, librarySidebarItemSize, setLibraryItemScale, setLibrarySidebarItemSize, variant]
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

  const gridLayout = useMemo(() => {
    const width = containerWidth || 1200;
    const columns = getColumnsForWidth(width, variant, libraryItemScale, activeSidebarItemSize);
    const gap = getGridGap(variant);
    const cardWidth = getCardWidth(width, columns, variant, libraryItemScale, activeSidebarItemSize);

    return {
      gap,
      maxWidth: getGridWidth(width, columns, variant, libraryItemScale, activeSidebarItemSize),
      gridTemplateColumns: `repeat(${columns}, minmax(0, ${cardWidth}px))`,
      justifyContent: variant === 'sidebar' ? 'start' : 'center',
    };
  }, [activeSidebarItemSize, containerWidth, libraryItemScale, variant]);

  const showColumnControl = variant === 'sidebar' && captures.length > 0;

  const renderColumnControl = () => (
    <div className="library-density-control" aria-label="Library card size">
      <input
        className="library-density-control__slider"
        type="range"
        min={LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MIN}
        max={LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MAX}
        step={LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_STEP}
        value={librarySidebarItemSize}
        onChange={(event) => setLibrarySidebarItemSize(Number(event.target.value))}
        aria-label="Media item size"
      />
      <div className="library-density-control__steps" aria-hidden="true">
        {[
          LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MIN,
          LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT,
          LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MAX,
        ].map((itemSize) => (
          <span
            key={itemSize}
            className={itemSize === librarySidebarItemSize ? 'library-density-control__step--active' : ''}
          />
        ))}
      </div>
    </div>
  );

  const renderCaptureGrid = () => (
    <div className="space-y-0">
      {dateGroups.map((group, groupIndex) => (
        <div key={group.label}>
          <DateHeader label={group.label} count={group.captures.length} isFirst={groupIndex === 0} />
          <div
            className="capture-grid"
            style={{
              gap: gridLayout.gap,
              gridTemplateColumns: gridLayout.gridTemplateColumns,
              maxWidth: gridLayout.maxWidth,
              justifyContent: gridLayout.justifyContent,
              marginLeft: variant === 'sidebar' ? 0 : 'auto',
              marginRight: variant === 'sidebar' ? 0 : 'auto',
            }}
          >
            {group.captures.map((capture) => (
              <CaptureCard
                key={capture.id}
                capture={capture}
                selected={selectedIds.has(capture.id)}
                isActive={activeCaptureId === capture.id}
                isLoading={loadingProjectId === capture.id}
                allTags={allTags}
                onSelect={handleSelect}
                onOpen={handleOpen}
                onToggleFavorite={() => toggleFavorite(capture.id)}
                onUpdateTags={(tags) => updateTags(capture.id, tags)}
                onDelete={() => handleRequestDeleteSingle(capture.id)}
                onOpenInFolder={() => handleOpenInFolder(capture)}
                onCopyToClipboard={() => handleCopyToClipboard(capture)}
                onPlayMedia={() => handlePlayMedia(capture)}
                onEditVideo={capture.capture_type === 'video' ? () => handleEditVideo(capture) : undefined}
                onSaveCopy={() => handleSaveCopy(capture)}
                onRepair={() => handleRepair(capture.id)}
                formatDate={formatDate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={300}>
      <div className={`library-panel library-panel--${variant} flex flex-col h-full relative`}>
        {/* Drop Zone Overlay */}
        {isDragOver && <DropZoneOverlay />}
        {showColumnControl && renderColumnControl()}

        {/* Content - use virtualization for large libraries, regular rendering for small ones */}
        {loading || !initialized ? (
          <div className="library-state-pane flex-1 flex items-center justify-center">
            <Loader2 className="w-12 h-12 text-[var(--coral-400)] animate-spin" />
          </div>
        ) : captures.length === 0 && hasActiveFilters && totalCaptureCount > 0 ? (
          <div className="library-state-pane flex-1 flex flex-col items-center justify-center gap-4 p-8">
            <div className="text-center space-y-2">
              <p className="text-sm text-[var(--ink-muted)]">No captures match the current filters</p>
              <p className="text-xs text-[var(--ink-faint)]">{totalCaptureCount} capture{totalCaptureCount !== 1 ? 's' : ''} hidden by filters</p>
            </div>
            <button
              onClick={clearAllFilters}
              className="editor-choice-pill editor-choice-pill--active px-4 py-2 text-xs font-medium"
            >
              Clear All Filters
            </button>
          </div>
        ) : captures.length === 0 ? (
          <div className="library-stage flex-1 overflow-auto p-8 pb-32">
            <EmptyState onNewCapture={handleNewImage} />
          </div>
        ) : useVirtualization ? (
          /* Virtualized rendering for large libraries (100+ captures) */
          <VirtualizedGrid
            variant={variant}
            itemScale={libraryItemScale}
            sidebarItemSize={activeSidebarItemSize}
            dateGroups={dateGroups}
            selectedIds={selectedIds}
            activeCaptureId={activeCaptureId}
            loadingProjectId={loadingProjectId}
            allTags={allTags}
            onSelect={handleSelect}
            onOpen={handleOpen}
            onToggleFavorite={toggleFavorite}
            onUpdateTags={updateTags}
            onDelete={handleRequestDeleteSingle}
            onOpenInFolder={handleOpenInFolder}
            onCopyToClipboard={handleCopyToClipboard}
            onPlayMedia={handlePlayMedia}
            onEditVideo={handleEditVideo}
            onSaveCopy={handleSaveCopy}
            onRepair={handleRepair}
            formatDate={formatDate}
            containerRef={containerRef as React.RefObject<HTMLDivElement>}
            onMouseDown={handleMarqueeMouseDown}
            onMouseMove={handleMarqueeMouseMove}
            onMouseUp={handleMarqueeMouseUp}
            isSelecting={isSelecting}
            selectionRect={selectionRect}
          />
        ) : (
          /* Non-virtualized rendering with marquee selection for smaller libraries */
          <div
            ref={containerRef}
            className="library-stage flex-1 overflow-auto p-8 pb-32 relative select-none library-scroll"
            onMouseDown={handleMarqueeMouseDown}
            onMouseMove={handleMarqueeMouseMove}
            onMouseUp={handleMarqueeMouseUp}
          >
            {/* Marquee Selection Rectangle */}
            {isSelecting && (
              <div
                className="absolute pointer-events-none z-50 border-2 border-[var(--coral-400)] bg-[var(--coral-glow)] rounded-sm"
                style={{
                  left: selectionRect.left,
                  top: selectionRect.top,
                  width: selectionRect.width,
                  height: selectionRect.height,
                }}
              />
            )}
            {renderCaptureGrid()}
          </div>
        )}

        {/* Delete Confirmation Dialog */}
        <DeleteDialog
          open={deleteDialog !== null}
          onOpenChange={(open) => !open && setDeleteDialog(null)}
          count={getDeleteCount()}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
        />

        {/* Floating Bottom Toolbar */}
        <GlassBlobToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          filterFavorites={filterFavorites}
          onFilterFavoritesChange={setFilterFavorites}
          filterTags={filterTags}
          onFilterTagsChange={setFilterTags}
          allTags={allTags}
          filterMediaTypes={filterMediaTypes}
          onFilterMediaTypesChange={setFilterMediaTypes}
          selectedCount={selectedIds.size}
          onDeleteSelected={handleRequestDeleteSelected}
          onClearSelection={clearSelection}
          onOpenLibraryFolder={handleOpenLibraryFolder}
          activeFilterCount={
            (filterFavorites ? 1 : 0) + filterTags.length + filterMediaTypes.length + (searchQuery ? 1 : 0)
          }
          onClearAllFilters={clearAllFilters}
        />
      </div>
    </TooltipProvider>
  );
};
