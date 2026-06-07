import { createContext, use } from 'react';
import { Loader2 } from 'lucide-react';
import type { CaptureListItem } from '../../types';
import { DateHeader } from './components/DateHeader';
import { EmptyState } from './components/EmptyState';
import { DropZoneOverlay } from './components/DropZoneOverlay';
import { CaptureCard } from './components/CaptureCard';
import { GlassBlobToolbar } from './components/GlassBlobToolbar';
import { DeleteDialog } from './components/DeleteDialog';
import { VirtualizedGrid } from './VirtualizedGrid';

export type LibraryVariant = 'full' | 'sidebar';

export interface DateGroup {
  label: string;
  captures: CaptureListItem[];
}

export type DeleteDialogState = { type: 'single'; id: string } | { type: 'bulk' } | null;

export interface LibraryGridLayout {
  gap: number;
  maxWidth: number;
  gridTemplateColumns: string;
  justifyContent: 'start' | 'center';
}

export interface LibraryCompositionContextValue {
  variant: LibraryVariant;
  loading: boolean;
  initialized: boolean;
  captures: CaptureListItem[];
  dateGroups: DateGroup[];
  hasActiveFilters: boolean;
  totalCaptureCount: number;
  useVirtualization: boolean;
  libraryItemScale: number;
  activeSidebarItemSize?: number;
  selectedIds: Set<string>;
  isSelecting: boolean;
  selectionRect: { left: number; top: number; width: number; height: number };
  activeCaptureId: string | null;
  loadingProjectId: string | null;
  allTags: string[];
  filterFavorites: boolean;
  filterTags: string[];
  filterMediaTypes: string[];
  searchQuery: string;
  activeFilterCount: number;
  deleteDialog: DeleteDialogState;
  deleteCount: number;
  isDragOver: boolean;
  gridLayout: LibraryGridLayout;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onClearAllFilters: () => void;
  onNewImage: () => void | Promise<void>;
  onSelect: (id: string, event: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onToggleFavorite: (id: string) => void | Promise<void>;
  onUpdateTags: (id: string, tags: string[]) => void | Promise<void>;
  onRequestDeleteSingle: (id: string) => void;
  onRequestDeleteSelected: () => void;
  onClearSelection: () => void;
  onOpenInFolder: (capture: CaptureListItem) => void | Promise<void>;
  onCopyToClipboard: (capture: CaptureListItem) => void | Promise<void>;
  onPlayMedia: (capture: CaptureListItem) => void | Promise<void>;
  onEditVideo: (capture: CaptureListItem) => void | Promise<void>;
  onSaveCopy: (capture: CaptureListItem) => void | Promise<void>;
  onRepair: (captureId: string) => void | Promise<void>;
  onFormatDate: (dateStr: string) => string;
  onMarqueeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMarqueeMouseMove: (event: React.MouseEvent<HTMLDivElement>) => void;
  onMarqueeMouseUp: () => void;
  onDeleteDialogOpenChange: (open: boolean) => void;
  onConfirmDelete: () => void | Promise<void>;
  onCancelDelete: () => void;
  onSearchChange: (query: string) => void;
  onFilterFavoritesChange: (value: boolean) => void;
  onFilterTagsChange: (tags: string[]) => void;
  onFilterMediaTypesChange: (types: string[]) => void;
  onOpenLibraryFolder: () => void | Promise<void>;
}

type LibraryContentState = 'loading' | 'filtered-empty' | 'empty' | 'virtualized' | 'static';
type LibraryContentRule = {
  state: LibraryContentState;
  matches: (library: LibraryCompositionContextValue) => boolean;
};

const LibraryCompositionContext = createContext<LibraryCompositionContextValue | null>(null);

const LIBRARY_CONTENT_RENDERERS: Record<LibraryContentState, () => React.ReactNode> = {
  loading: () => <Library.LoadingState />,
  'filtered-empty': () => <Library.FilteredEmptyState />,
  empty: () => <Library.EmptyState />,
  virtualized: () => <Library.VirtualizedGridStage />,
  static: () => <Library.StaticGridStage />,
};

const LIBRARY_CONTENT_RULES: LibraryContentRule[] = [
  {
    state: 'loading',
    matches: ({ loading, initialized }) => loading || !initialized,
  },
  {
    state: 'filtered-empty',
    matches: ({ captures, hasActiveFilters, totalCaptureCount }) =>
      captures.length === 0 && hasActiveFilters && totalCaptureCount > 0,
  },
  {
    state: 'empty',
    matches: ({ captures }) => captures.length === 0,
  },
  {
    state: 'virtualized',
    matches: ({ useVirtualization }) => useVirtualization,
  },
];

function getLibraryContentState(library: LibraryCompositionContextValue): LibraryContentState {
  return LIBRARY_CONTENT_RULES.find((rule) => rule.matches(library))?.state ?? 'static';
}

function useLibraryComposition() {
  const context = use(LibraryCompositionContext);
  if (!context) {
    throw new Error('Library composition components must be rendered inside Library.Provider');
  }
  return context;
}

function LibraryProvider({
  value,
  children,
}: {
  value: LibraryCompositionContextValue;
  children: React.ReactNode;
}) {
  return (
    <LibraryCompositionContext value={value}>
      {children}
    </LibraryCompositionContext>
  );
}

function LibraryDropZone() {
  const library = useLibraryComposition();
  return library.isDragOver ? <DropZoneOverlay /> : null;
}

function LibraryLoadingState() {
  return (
    <div className="library-state-pane flex-1 flex items-center justify-center">
      <Loader2 className="w-12 h-12 text-[var(--accent-400)] animate-spin" />
    </div>
  );
}

function LibraryFilteredEmptyState() {
  const library = useLibraryComposition();

  return (
    <div className="library-state-pane flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <div className="text-center space-y-2">
        <p className="text-sm text-[var(--ink-muted)]">No captures match the current filters</p>
        <p className="text-xs text-[var(--ink-faint)]">
          {library.totalCaptureCount} capture{library.totalCaptureCount !== 1 ? 's' : ''} hidden by filters
        </p>
      </div>
      <button
        onClick={library.onClearAllFilters}
        className="editor-choice-pill editor-choice-pill--active px-4 py-2 text-xs font-medium"
      >
        Clear All Filters
      </button>
    </div>
  );
}

function LibraryEmptyState() {
  const library = useLibraryComposition();

  return (
    <div className="library-stage flex-1 overflow-auto p-8 pb-32">
      <EmptyState onNewCapture={library.onNewImage} />
    </div>
  );
}

function LibraryMarqueeRect() {
  const library = useLibraryComposition();

  if (!library.isSelecting) {
    return null;
  }

  return (
    <div
      className="absolute pointer-events-none z-50 border-2 border-[var(--accent-400)] bg-[var(--accent-glow)] rounded-sm"
      style={{
        left: library.selectionRect.left,
        top: library.selectionRect.top,
        width: library.selectionRect.width,
        height: library.selectionRect.height,
      }}
    />
  );
}

function LibraryCaptureGrid() {
  const library = useLibraryComposition();

  return (
    <div className="space-y-0">
      {library.dateGroups.map((group, groupIndex) => (
        <div key={group.label}>
          <DateHeader label={group.label} count={group.captures.length} isFirst={groupIndex === 0} />
          <div
            className="capture-grid"
            style={{
              gap: library.gridLayout.gap,
              gridTemplateColumns: library.gridLayout.gridTemplateColumns,
              maxWidth: library.gridLayout.maxWidth,
              justifyContent: library.gridLayout.justifyContent,
              marginLeft: library.variant === 'sidebar' ? 0 : 'auto',
              marginRight: library.variant === 'sidebar' ? 0 : 'auto',
            }}
          >
            {group.captures.map((capture) => (
              <CaptureCard
                key={capture.id}
                capture={capture}
                selected={library.selectedIds.has(capture.id)}
                isActive={library.activeCaptureId === capture.id}
                isLoading={library.loadingProjectId === capture.id}
                allTags={library.allTags}
                onSelect={library.onSelect}
                onOpen={library.onOpen}
                onToggleFavorite={() => library.onToggleFavorite(capture.id)}
                onUpdateTags={(tags) => library.onUpdateTags(capture.id, tags)}
                onDelete={() => library.onRequestDeleteSingle(capture.id)}
                onOpenInFolder={() => library.onOpenInFolder(capture)}
                onCopyToClipboard={() => library.onCopyToClipboard(capture)}
                onPlayMedia={() => library.onPlayMedia(capture)}
                onEditVideo={capture.capture_type === 'video' ? () => library.onEditVideo(capture) : undefined}
                onSaveCopy={() => library.onSaveCopy(capture)}
                onRepair={() => library.onRepair(capture.id)}
                formatDate={library.onFormatDate}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LibraryStaticGridStage() {
  const library = useLibraryComposition();

  return (
    <div
      ref={library.containerRef}
      className="library-stage flex-1 overflow-auto p-8 pb-32 relative select-none library-scroll"
      onMouseDown={library.onMarqueeMouseDown}
      onMouseMove={library.onMarqueeMouseMove}
      onMouseUp={library.onMarqueeMouseUp}
    >
      <Library.MarqueeRect />
      <Library.CaptureGrid />
    </div>
  );
}

function LibraryVirtualizedGridStage() {
  const library = useLibraryComposition();

  return (
    <VirtualizedGrid
      variant={library.variant}
      itemScale={library.libraryItemScale}
      sidebarItemSize={library.activeSidebarItemSize}
      dateGroups={library.dateGroups}
      selectedIds={library.selectedIds}
      activeCaptureId={library.activeCaptureId}
      loadingProjectId={library.loadingProjectId}
      allTags={library.allTags}
      onSelect={library.onSelect}
      onOpen={library.onOpen}
      onToggleFavorite={library.onToggleFavorite}
      onUpdateTags={library.onUpdateTags}
      onDelete={library.onRequestDeleteSingle}
      onOpenInFolder={library.onOpenInFolder}
      onCopyToClipboard={library.onCopyToClipboard}
      onPlayMedia={library.onPlayMedia}
      onEditVideo={library.onEditVideo}
      onSaveCopy={library.onSaveCopy}
      onRepair={library.onRepair}
      formatDate={library.onFormatDate}
      containerRef={library.containerRef as React.RefObject<HTMLDivElement>}
      onMouseDown={library.onMarqueeMouseDown}
      onMouseMove={library.onMarqueeMouseMove}
      onMouseUp={library.onMarqueeMouseUp}
      isSelecting={library.isSelecting}
      selectionRect={library.selectionRect}
    />
  );
}

function LibraryContent() {
  const library = useLibraryComposition();
  const state = getLibraryContentState(library);
  return LIBRARY_CONTENT_RENDERERS[state]();
}

function LibraryDeleteDialog() {
  const library = useLibraryComposition();

  return (
    <DeleteDialog
      open={library.deleteDialog !== null}
      onOpenChange={library.onDeleteDialogOpenChange}
      count={library.deleteCount}
      onConfirm={library.onConfirmDelete}
      onCancel={library.onCancelDelete}
    />
  );
}

function LibraryToolbar() {
  const library = useLibraryComposition();

  return (
    <GlassBlobToolbar
      searchQuery={library.searchQuery}
      onSearchChange={library.onSearchChange}
      filterFavorites={library.filterFavorites}
      onFilterFavoritesChange={library.onFilterFavoritesChange}
      filterTags={library.filterTags}
      onFilterTagsChange={library.onFilterTagsChange}
      allTags={library.allTags}
      filterMediaTypes={library.filterMediaTypes}
      onFilterMediaTypesChange={library.onFilterMediaTypesChange}
      selectedCount={library.selectedIds.size}
      onDeleteSelected={library.onRequestDeleteSelected}
      onClearSelection={library.onClearSelection}
      onOpenLibraryFolder={library.onOpenLibraryFolder}
      activeFilterCount={library.activeFilterCount}
      onClearAllFilters={library.onClearAllFilters}
    />
  );
}

export const Library = {
  Provider: LibraryProvider,
  DropZone: LibraryDropZone,
  LoadingState: LibraryLoadingState,
  FilteredEmptyState: LibraryFilteredEmptyState,
  EmptyState: LibraryEmptyState,
  MarqueeRect: LibraryMarqueeRect,
  CaptureGrid: LibraryCaptureGrid,
  StaticGridStage: LibraryStaticGridStage,
  VirtualizedGridStage: LibraryVirtualizedGridStage,
  Content: LibraryContent,
  DeleteDialog: LibraryDeleteDialog,
  Toolbar: LibraryToolbar,
};
