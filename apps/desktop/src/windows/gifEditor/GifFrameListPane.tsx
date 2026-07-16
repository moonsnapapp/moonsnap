import type { MouseEvent, RefObject } from 'react';
import { Copy, RotateCcw, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { formatMs } from './frameOps';
import type { FrameRow } from './types';

interface GifFrameListPaneProps {
  rows: FrameRow[];
  selectedIds: Set<string>;
  selectedCount: number;
  currentFrameIndex: number;
  delayInput: string;
  listRef: RefObject<HTMLDivElement | null>;
  onRowMouseDown: (id: string, event: MouseEvent) => void;
  onRowMouseEnter: (id: string, event: MouseEvent) => void;
  onRowDoubleClick: (id: string) => void;
  onRowContextMenu: (row: FrameRow, index: number) => void;
  onExportSelectedFrames: () => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onOpenDelayDialog: (rowIds: string[]) => void;
  onResetTimings: () => void;
  onOpenDropDialog: () => void;
  onDelayInputChange: (value: string) => void;
  onApplyDelayToSelection: () => void;
  onApplyDelayToAll: () => void;
}

function getGifFrameHeaderLabel(rowCount: number) {
  return rowCount > 0 ? `Frames (${rowCount})` : 'Frames';
}

function GifFrameRow({
  row,
  index,
  selectedIds,
  currentFrameIndex,
  onRowMouseDown,
  onRowMouseEnter,
  onRowDoubleClick,
  onRowContextMenu,
}: {
  row: FrameRow;
  index: number;
  selectedIds: Set<string>;
  currentFrameIndex: number;
  onRowMouseDown: (id: string, event: MouseEvent) => void;
  onRowMouseEnter: (id: string, event: MouseEvent) => void;
  onRowDoubleClick: (id: string) => void;
  onRowContextMenu: (row: FrameRow, index: number) => void;
}) {
  const isSelected = selectedIds.has(row.id);
  const isPlayhead = index === currentFrameIndex;
  const isCustomDelay = row.delayMs !== row.originalDelayMs;

  return (
    <tr
      key={row.id}
      data-row-id={row.id}
      data-row-index={index}
      onMouseDown={(event) => onRowMouseDown(row.id, event)}
      onMouseEnter={(event) => onRowMouseEnter(row.id, event)}
      onDoubleClick={() => onRowDoubleClick(row.id)}
      onContextMenu={() => onRowContextMenu(row, index)}
      className={cn(
        'cursor-pointer select-none',
        isSelected ? 'bg-(--accent-400)/20 text-(--ink-black)' : 'hover:bg-(--polar-mist)/40',
      )}
    >
      <td
        className={cn(
          'px-3 py-1 tabular-nums border-l-2',
          isPlayhead ? 'border-(--accent-400)' : 'border-transparent',
        )}
      >
        {index + 1}
      </td>
      <td
        className={cn(
          'px-3 py-1 tabular-nums',
          isCustomDelay && 'text-(--accent-400)',
        )}
      >
        {formatMs(row.delayMs)}
      </td>
    </tr>
  );
}

export function GifFrameListPane({
  rows,
  selectedIds,
  selectedCount,
  currentFrameIndex,
  delayInput,
  listRef,
  onRowMouseDown,
  onRowMouseEnter,
  onRowDoubleClick,
  onRowContextMenu,
  onExportSelectedFrames,
  onDeleteSelected,
  onDuplicateSelected,
  onOpenDelayDialog,
  onResetTimings,
  onOpenDropDialog,
  onDelayInputChange,
  onApplyDelayToSelection,
  onApplyDelayToAll,
}: GifFrameListPaneProps) {
  return (
    <aside className="w-[240px] shrink-0 border-r border-(--polar-mist) flex flex-col bg-[var(--card)]">
      <div className="px-3 py-2 border-b border-(--polar-mist) flex items-center justify-between text-xs text-(--ink-muted)">
        <span>{getGifFrameHeaderLabel(rows.length)}</span>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={listRef}
            className="flex-1 min-h-0 overflow-y-auto"
            tabIndex={0}
          >
            <table className="w-full text-sm border-collapse">
              <thead className="text-xs text-(--ink-muted)">
                <tr>
                  <th className="sticky top-0 z-10 bg-[var(--card)] text-left px-3 py-1 font-medium w-12 border-b border-(--polar-mist)">
                    No.
                  </th>
                  <th className="sticky top-0 z-10 bg-[var(--card)] text-left px-3 py-1 font-medium border-b border-(--polar-mist)">
                    Delay
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <GifFrameRow
                    key={row.id}
                    row={row}
                    index={index}
                    selectedIds={selectedIds}
                    currentFrameIndex={currentFrameIndex}
                    onRowMouseDown={onRowMouseDown}
                    onRowMouseEnter={onRowMouseEnter}
                    onRowDoubleClick={onRowDoubleClick}
                    onRowContextMenu={onRowContextMenu}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem
            disabled={selectedCount === 0}
            onSelect={() => void onExportSelectedFrames()}
          >
            Export selected framesâ€¦
            <ContextMenuShortcut>Ctrl+Shift+E</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedCount === 0 || rows.length - selectedCount < 1}
            onSelect={onDeleteSelected}
          >
            Delete
            <ContextMenuShortcut>Del</ContextMenuShortcut>
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedCount === 0}
            onSelect={onDuplicateSelected}
          >
            Duplicate
          </ContextMenuItem>
          <ContextMenuItem
            disabled={selectedCount === 0}
            onSelect={() => onOpenDelayDialog(Array.from(selectedIds))}
          >
            Set frame delayâ€¦
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div className="p-3 border-t border-(--polar-mist) flex flex-col gap-2">
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={onDeleteSelected}
            disabled={selectedCount === 0}
            title="Delete selected frame(s)"
            className="flex-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onDuplicateSelected}
            disabled={selectedCount === 0}
            title="Duplicate selected frame(s)"
            className="flex-1"
          >
            <Copy className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onResetTimings}
            title="Reset all delays to original"
            className="flex-1"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onOpenDropDialog}
          disabled={rows.length === 0}
          title="Drop frames in a pattern (even, odd, every Nth)"
          className="text-xs"
        >
          Drop framesâ€¦
        </Button>

        <div className="flex flex-col gap-1">
          <Label className="text-xs text-(--ink-muted)">Delay (ms)</Label>
          <Input
            type="number"
            min={1}
            max={60000}
            step={1}
            value={delayInput}
            onChange={(e) => onDelayInputChange(e.target.value)}
            placeholder="e.g. 50"
            className="h-8 text-sm"
          />
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              onClick={onApplyDelayToSelection}
              disabled={selectedCount === 0 || delayInput === ''}
              className="flex-1 text-xs"
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onApplyDelayToAll}
              disabled={delayInput === '' || rows.length === 0}
              className="flex-1 text-xs"
            >
              Apply to all
            </Button>
          </div>
          <p className="text-[10px] text-(--ink-muted) leading-snug">
            Click to select. Shift/Ctrl for multi-select.
          </p>
        </div>
      </div>
    </aside>
  );
}
