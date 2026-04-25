import { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { CaptureListItem } from '../../types';
// Direct imports avoid barrel file bundling overhead
import { DateHeader } from './components/DateHeader';
import { CaptureCard } from './components/CaptureCard';
import { useThumbnailPrefetch } from './hooks';
import { LAYOUT, TIMING } from '../../constants';

interface DateGroup {
  label: string;
  captures: CaptureListItem[];
}

// Row types for virtualization
type VirtualRow =
  | { type: 'header'; label: string; count: number; isFirst: boolean }
  | { type: 'cardRow'; captures: CaptureListItem[] };

interface VirtualizedGridProps {
  variant?: 'full' | 'sidebar';
  itemScale?: number;
  sidebarItemSize?: number;
  dateGroups: DateGroup[];
  selectedIds: Set<string>;
  loadingProjectId: string | null;
  allTags: string[];
  onSelect: (id: string, e: React.MouseEvent) => void;
  onOpen: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onUpdateTags: (id: string, tags: string[]) => void;
  onDelete: (id: string) => void;
  onOpenInFolder: (capture: CaptureListItem) => void;
  onCopyToClipboard: (capture: CaptureListItem) => void;
  onPlayMedia: (capture: CaptureListItem) => void;
  onEditVideo?: (capture: CaptureListItem) => void;
  onSaveCopy?: (capture: CaptureListItem) => void;
  onRepair?: (captureId: string) => void;
  formatDate: (dateStr: string) => string;
  // Marquee selection props
  containerRef?: React.RefObject<HTMLDivElement>;
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseMove?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onMouseUp?: () => void;
  isSelecting?: boolean;
  selectionRect?: { left: number; top: number; width: number; height: number };
}

// Layout constants
const SIDEBAR_CARD_GAP = 12;
const MAX_CARD_WIDTH = 320; // Cards won't grow beyond this
const SIDEBAR_CONTAINER_PADDING = 24;
const FULL_CONTENT_OFFSET = 32;
const FULL_SCROLL_BUFFER = 128;

// Column breakpoints: min 3, max 5 columns
// Cards resize to fill available width, capped at MAX_CARD_WIDTH
const COLUMN_BREAKPOINTS = [
  { minWidth: 1600, cols: 5 },
  { minWidth: 1200, cols: 4 },
  { minWidth: 0, cols: 3 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function getGridGap(variant: 'full' | 'sidebar' = 'full'): number {
  return variant === 'sidebar' ? SIDEBAR_CARD_GAP : LAYOUT.GRID_GAP;
}

export function getScaledCardTargetWidth(
  itemScale: number = LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT
): number {
  return clamp(
    Math.round(LAYOUT.LIBRARY_ITEM_WIDTH_BASE * itemScale),
    LAYOUT.LIBRARY_ITEM_WIDTH_MIN,
    LAYOUT.LIBRARY_ITEM_WIDTH_MAX
  );
}

function getDefaultColumnsForWidth(width: number, variant: 'full' | 'sidebar'): number {
  if (variant === 'sidebar') return 1;

  for (const bp of COLUMN_BREAKPOINTS) {
    if (width >= bp.minWidth) return bp.cols;
  }
  return 3;
}

export function getColumnsForWidth(
  width: number,
  variant: 'full' | 'sidebar' = 'full',
  itemScale: number = LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT,
  sidebarItemSize: number = LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT
): number {
  if (variant === 'sidebar') {
    const availableWidth = width - SIDEBAR_CONTAINER_PADDING;
    const clampedItemSize = clamp(
      sidebarItemSize,
      LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MIN,
      LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_MAX
    ) as keyof typeof LAYOUT.LIBRARY_SIDEBAR_ITEM_MIN_WIDTH_BY_SIZE;
    const minCardWidth =
      LAYOUT.LIBRARY_SIDEBAR_ITEM_MIN_WIDTH_BY_SIZE[clampedItemSize] ??
      LAYOUT.LIBRARY_SIDEBAR_ITEM_MIN_WIDTH_BY_SIZE[LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT];
    const maxFittingColumns = Math.max(
      1,
      Math.floor((availableWidth + SIDEBAR_CARD_GAP) / (minCardWidth + SIDEBAR_CARD_GAP))
    );
    return Math.min(LAYOUT.LIBRARY_GRID_MAX_COLUMNS, maxFittingColumns);
  }

  if (itemScale === LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT) {
    return getDefaultColumnsForWidth(width, variant);
  }

  const cardGap = getGridGap(variant);
  const availableWidth = width - LAYOUT.CONTAINER_PADDING;
  const targetWidth = getScaledCardTargetWidth(itemScale);
  const rawColumns = Math.floor((availableWidth + cardGap) / (targetWidth + cardGap));
  return clamp(rawColumns, 2, LAYOUT.LIBRARY_GRID_MAX_COLUMNS);
}

// Calculate card width to fit exactly N columns, capped at MAX_CARD_WIDTH
export function getCardWidth(
  containerWidth: number,
  columns: number,
  variant: 'full' | 'sidebar' = 'full',
  itemScale: number = LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT,
  _sidebarItemSize: number = LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT
): number {
  if (variant === 'sidebar') {
    const availableWidth = Math.max(0, containerWidth - SIDEBAR_CONTAINER_PADDING);
    const cardGap = getGridGap(variant);
    const calculatedWidth = Math.floor((availableWidth - cardGap * (columns - 1)) / columns);
    return Math.max(0, calculatedWidth);
  }

  const availableWidth = containerWidth - LAYOUT.CONTAINER_PADDING;
  const totalGaps = LAYOUT.GRID_GAP * (columns - 1);
  const calculatedWidth = Math.floor((availableWidth - totalGaps) / columns);
  const maxWidth =
    itemScale === LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT
      ? MAX_CARD_WIDTH
      : LAYOUT.LIBRARY_ITEM_WIDTH_MAX;
  return Math.min(calculatedWidth, maxWidth);
}

// Calculate row height based on a true square card.
// Gap is included in row height for predictable sizing during resize
export function calculateRowHeight(
  containerWidth: number,
  columns: number,
  variant: 'full' | 'sidebar' = 'full',
  itemScale: number = LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT,
  sidebarItemSize: number = LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT
): number {
  const cardWidth = getCardWidth(containerWidth, columns, variant, itemScale, sidebarItemSize);
  const cardGap = getGridGap(variant);
  return cardWidth + cardGap;
}

// Calculate total grid width (for centering headers and cards together)
export function getGridWidth(
  containerWidth: number,
  columns: number,
  variant: 'full' | 'sidebar' = 'full',
  itemScale: number = LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT,
  sidebarItemSize: number = LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT
): number {
  const cardWidth = getCardWidth(containerWidth, columns, variant, itemScale, sidebarItemSize);
  const cardGap = getGridGap(variant);
  return columns * cardWidth + (columns - 1) * cardGap;
}

export function VirtualizedGrid({
  variant = 'full',
  itemScale = LAYOUT.LIBRARY_ITEM_SCALE_DEFAULT,
  sidebarItemSize = LAYOUT.LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT,
  dateGroups,
  selectedIds,
  loadingProjectId,
  allTags,
  onSelect,
  onOpen,
  onToggleFavorite,
  onUpdateTags,
  onDelete,
  onOpenInFolder,
  onCopyToClipboard,
  onPlayMedia,
  onEditVideo,
  onSaveCopy,
  onRepair,
  formatDate,
  containerRef: externalContainerRef,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  isSelecting,
  selectionRect,
}: VirtualizedGridProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [cardsPerRow, setCardsPerRow] = useState(() => getColumnsForWidth(1200, variant, itemScale, sidebarItemSize));
  const [containerWidth, setContainerWidth] = useState(1200);
  const isSidebar = variant === 'sidebar';

  // Sync external ref
  useEffect(() => {
    if (externalContainerRef && 'current' in externalContainerRef) {
      (externalContainerRef as React.MutableRefObject<HTMLDivElement | null>).current =
        scrollContainerRef.current;
    }
  });

  // Track container width for responsive layout (breakpoint-based)
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const updateLayout = () => {
      const width = container.clientWidth;
      const cols = getColumnsForWidth(width, variant, itemScale, sidebarItemSize);
      setCardsPerRow(prev => prev !== cols ? cols : prev);
      setContainerWidth(width);
    };

    const debouncedUpdate = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateLayout, TIMING.RESIZE_DEBOUNCE_MS);
    };

    // Initial layout without debounce
    updateLayout();

    const observer = new ResizeObserver(debouncedUpdate);
    observer.observe(container);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [itemScale, sidebarItemSize, variant]);

  // Build rows: headers + card/list rows
  const rows = useMemo<VirtualRow[]>(() => {
    const result: VirtualRow[] = [];
    const itemsPerRow = cardsPerRow;

    dateGroups.forEach((group, groupIndex) => {
      result.push({
        type: 'header',
        label: group.label,
        count: group.captures.length,
        isFirst: groupIndex === 0,
      });

      for (let i = 0; i < group.captures.length; i += itemsPerRow) {
        result.push({
          type: 'cardRow',
          captures: group.captures.slice(i, i + itemsPerRow),
        });
      }
    });

    return result;
  }, [dateGroups, cardsPerRow]);

  // Calculate dynamic row height based on actual card dimensions
  const gridRowHeight = useMemo(
    () => calculateRowHeight(containerWidth, cardsPerRow, variant, itemScale, sidebarItemSize),
    [containerWidth, cardsPerRow, itemScale, sidebarItemSize, variant]
  );

  // Virtualizer with dynamic row heights based on card size
  // Gap is included in gridRowHeight for predictable resize behavior
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      if (!row) return gridRowHeight;
      if (row.type === 'header') return LAYOUT.HEADER_HEIGHT;
      return gridRowHeight;
    },
    overscan: 5,
  });

  // Force virtualizer to recalculate when row height changes during resize
  useEffect(() => {
    virtualizer.measure();
  }, [gridRowHeight, virtualizer]);

  // Prefetch thumbnails for rows about to enter the viewport
  const virtualItems = virtualizer.getVirtualItems();
  const visibleRange = useMemo(() => ({
    startIndex: virtualItems[0]?.index ?? 0,
    endIndex: virtualItems[virtualItems.length - 1]?.index ?? 0,
  }), [virtualItems]);

  useThumbnailPrefetch(rows, visibleRange, 3);

  // Calculate grid width for centering (same width for headers and cards)
  const gridWidth = useMemo(
    () => getGridWidth(containerWidth, cardsPerRow, variant, itemScale, sidebarItemSize),
    [containerWidth, cardsPerRow, itemScale, sidebarItemSize, variant]
  );

  // Render row content
  const renderRowContent = useCallback(
    (row: VirtualRow) => {
      if (row.type === 'header') {
        return (
          <div className={isSidebar ? '' : 'mx-auto'} style={{ width: gridWidth }}>
            <DateHeader
              label={row.label}
              count={row.count}
              isFirst={row.isFirst}
            />
          </div>
        );
      }

      const cardWidth = getCardWidth(containerWidth, cardsPerRow, variant, itemScale, sidebarItemSize);
      const cardGap = getGridGap(variant);

      return (
        <div className={`flex ${isSidebar ? '' : 'mx-auto'}`} style={{ width: gridWidth, gap: cardGap }}>
          {row.captures.map((capture) => (
            <div key={capture.id} style={{ width: cardWidth, flexShrink: 0 }}>
              <CaptureCard
                capture={capture}
                selected={selectedIds.has(capture.id)}
                isLoading={loadingProjectId === capture.id}
                allTags={allTags}
                onSelect={onSelect}
                onOpen={onOpen}
                onToggleFavorite={() => onToggleFavorite(capture.id)}
                onUpdateTags={(tags) => onUpdateTags(capture.id, tags)}
                onDelete={() => onDelete(capture.id)}
                onOpenInFolder={() => onOpenInFolder(capture)}
                onCopyToClipboard={() => onCopyToClipboard(capture)}
                onPlayMedia={() => onPlayMedia(capture)}
                onEditVideo={capture.capture_type === 'video' && onEditVideo ? () => onEditVideo(capture) : undefined}
                onSaveCopy={onSaveCopy ? () => onSaveCopy(capture) : undefined}
                onRepair={onRepair ? () => onRepair(capture.id) : undefined}
                formatDate={formatDate}
              />
            </div>
          ))}
        </div>
      );
    },
    [
      cardsPerRow,
      containerWidth,
      gridWidth,
      isSidebar,
      itemScale,
      sidebarItemSize,
      selectedIds,
      loadingProjectId,
      allTags,
      onSelect,
      onOpen,
      onToggleFavorite,
      onUpdateTags,
      onDelete,
      onOpenInFolder,
      onCopyToClipboard,
      onPlayMedia,
      onEditVideo,
      onSaveCopy,
      onRepair,
      formatDate,
      variant,
    ]
  );
  const contentOffset = isSidebar ? 0 : FULL_CONTENT_OFFSET;
  const scrollBuffer = isSidebar ? 0 : FULL_SCROLL_BUFFER;

  return (
    <div
      ref={scrollContainerRef}
      className="library-stage flex-1 overflow-auto relative select-none library-scroll"
      style={{ contain: 'strict' }}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {isSelecting && selectionRect && (
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

      <div
        className={`relative w-full ${isSidebar ? '' : 'px-8'}`}
        style={{ height: virtualizer.getTotalSize() + scrollBuffer, paddingTop: contentOffset }}
      >
        {virtualItems.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;

          return (
            <div
              key={virtualRow.key}
              className={`absolute left-0 right-0 ${isSidebar ? '' : 'px-8'}`}
              style={{
                top: virtualRow.start + contentOffset,
                height: virtualRow.size,
              }}
            >
              {renderRowContent(row)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default VirtualizedGrid;
