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
import { VirtualizedGrid, getColumnsForWidth, calculateRowHeight, getCardWidth, getGridWidth } from './VirtualizedGrid';

// VirtualizedGrid positioning offsets (from `top: virtualRow.start + 32` and `px-8`)
const CONTENT_OFFSET_Y = 32; // vertical offset from inline positioning style
const CONTENT_OFFSET_X = 32; // horizontal padding (px-8) on virtual items

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

export const CaptureLibrary: React.FC = () => {
  const {
    loading,
    initialized,
    loadingProjectId,
    loadCaptures,
    deleteCapture,
    deleteCaptures,
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
  } = useCaptureStore();

  const { settings } = useSettingsStore();

  const totalCaptureCount = useCaptureStore((state) => state.captures.length);
  const captures = useFilteredCaptures();
  const allTags = useAllTags();
  const hasActiveFilters = filterFavorites || filterTags.length > 0 || filterMediaTypes.length > 0 || searchQuery.length > 0;

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setFilterFavorites(false);
    setFilterTags([]);
    setFilterMediaTypes([]);
  }, [setSearchQuery, setFilterFavorites, setFilterTags, setFilterMediaTypes]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  // Use virtualization for large libraries (100+ captures)
  const useVirtualization = captures.length > 100;

  // Track container width for virtual layout calculations (debounced for performance)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !useVirtualization) return;

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
  }, [useVirtualization]);

  // Compute date groups
  const dateGroups = useMemo(() => groupCapturesByDate(captures), [captures]);

  // Compute virtual layout info for marquee selection
  const virtualLayout = useMemo<VirtualLayoutInfo | undefined>(() => {
    if (!useVirtualization || containerWidth === 0) return undefined;

    // Use the same breakpoint-based column calculation as VirtualizedGrid
    const cardsPerRow = getColumnsForWidth(containerWidth);

    // Use the same card width calculation as VirtualizedGrid (capped at MAX_CARD_WIDTH)
    const cardWidth = getCardWidth(containerWidth, cardsPerRow);

    // Use dynamic row height calculation matching VirtualizedGrid
    const gridRowHeight = calculateRowHeight(containerWidth, cardsPerRow);

    // Calculate grid width for centering calculations
    const gridWidth = getGridWidth(containerWidth, cardsPerRow);

    return {
      cardsPerRow,
      gridRowHeight,
      cardWidth,
      headerHeight: LAYOUT.HEADER_HEIGHT,
      gridGap: LAYOUT.GRID_GAP,
      contentOffsetY: CONTENT_OFFSET_Y,
      contentOffsetX: CONTENT_OFFSET_X,
      gridWidth,
      containerWidth,
      dateGroups,
    };
  }, [useVirtualization, containerWidth, dateGroups]);

  // Delete confirmation state - consolidated into single object
  type DeleteDialogState = { type: 'single'; id: string } | { type: 'bulk' } | null;
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialogState>(null);

  // Open image in dedicated editor window
  const handleEditImage = useCallback(async (capture: CaptureListItem) => {
    try {
      // Open image in a dedicated floating window
      // If the image is already open, the existing window will be focused
      await invoke('show_image_editor_window', { capturePath: capture.image_path });
    } catch (error) {
      reportError(error, { operation: 'image editor open' });
      toast.error('Failed to open image editor');
    }
  }, []);

  const handleEditVideo = useCallback(async (capture: CaptureListItem) => {
    try {
      // Open video in a dedicated floating window
      // If the video is already open, the existing window will be focused
      await invoke('show_video_editor_window', { projectPath: capture.image_path });
    } catch (error) {
      reportError(error, { operation: 'video editor open' });
      toast.error('Failed to open video editor');
    }
  }, []);

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
  }, [selectedIds.size, handleRequestDeleteSelected, clearSelection]);

  const handleConfirmDelete = async () => {
    try {
      if (deleteDialog?.type === 'bulk') {
        await deleteCaptures(Array.from(selectedIds));
        setSelectedIds(new Set());
        toast.success(`Deleted ${selectedIds.size} capture${selectedIds.size > 1 ? 's' : ''}`);
      } else if (deleteDialog?.type === 'single') {
        await deleteCapture(deleteDialog.id);
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
      const ext = capture.capture_type === 'gif' ? 'gif' : 'mp4';
      const filterName = capture.capture_type === 'gif' ? 'GIF' : 'Video';
      // Use original filename as default save name
      const originalName = capture.image_path.replace(/\\/g, '/').split('/').pop() || `recording.${ext}`;
      const destination = await saveFileDialog({
        title: 'Save Copy',
        defaultPath: originalName,
        filters: [{ name: filterName, extensions: [ext] }],
      });
      if (destination) {
        await invoke('save_copy_of_file', {
          sourcePath: capture.image_path,
          destinationPath: destination,
        });
        toast.success('Copy saved');
      }
    } catch (error) {
      reportError(error, { operation: 'save copy' });
      toast.error('Failed to save copy');
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

  const renderCaptureGrid = () => (
    <div className="space-y-0">
      {dateGroups.map((group, groupIndex) => (
        <div key={group.label}>
          <DateHeader label={group.label} count={group.captures.length} isFirst={groupIndex === 0} />
          <div className="capture-grid">
            {group.captures.map((capture) => (
              <CaptureCard
                key={capture.id}
                capture={capture}
                selected={selectedIds.has(capture.id)}
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
                onSaveCopy={capture.quick_capture ? () => handleSaveCopy(capture) : undefined}
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
      <div className="library-panel flex flex-col h-full relative">
        {/* Drop Zone Overlay */}
        {isDragOver && <DropZoneOverlay />}

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
              className="px-4 py-2 text-xs font-medium rounded-lg bg-[var(--coral-500)] text-white hover:bg-[var(--coral-600)] transition-colors"
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
            dateGroups={dateGroups}
            selectedIds={selectedIds}
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
