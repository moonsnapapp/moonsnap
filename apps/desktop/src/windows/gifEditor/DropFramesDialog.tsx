import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { formatDuration } from './frameOps';
import type { DropDialogState, DropDialogStats } from './types';

interface DropFramesDialogProps {
  dialog: DropDialogState | null;
  stats: DropDialogStats | null;
  onChange: (next: DropDialogState) => void;
  onApply: () => void;
  onClose: () => void;
}

const DROP_FRAME_MODE_OPTIONS = [
  { v: 'none', label: 'Show original' },
  { v: 'even', label: 'Even frames (2, 4, 6...)' },
  { v: 'odd', label: 'Odd frames (1, 3, 5...)' },
  { v: 'every-n', label: 'Delete every N-th frame' },
] as const;

function getPlaybackSpeedCopy(keepPlaybackSpeed: boolean): string {
  return keepPlaybackSpeed
    ? 'Dropped frames delays fold into the kept frames so total time stays the same.'
    : 'Each kept frame keeps its original delay - total time shrinks.';
}

function handleDropDialogOpenChange(next: boolean, onClose: () => void): void {
  if (!next) onClose();
}

function DropFrameModeOptions({
  dialog,
  onChange,
}: {
  dialog: DropDialogState;
  onChange: (next: DropDialogState) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {DROP_FRAME_MODE_OPTIONS.map((opt) => (
        <label
          key={opt.v}
          className="flex items-center gap-2 text-sm cursor-pointer"
        >
          <input
            type="radio"
            name="drop-mode"
            checked={dialog.mode === opt.v}
            onChange={() => onChange({ ...dialog, mode: opt.v })}
          />
          {opt.label}
        </label>
      ))}
    </div>
  );
}

function DropEveryNControl({
  dialog,
  onChange,
}: {
  dialog: DropDialogState;
  onChange: (next: DropDialogState) => void;
}) {
  if (dialog.mode !== 'every-n') {
    return null;
  }

  return (
    <div className="pl-5 flex items-center gap-3">
      <Slider
        className="flex-1"
        value={[dialog.nValue]}
        min={2}
        max={20}
        step={1}
        onValueChange={(v) => onChange({ ...dialog, nValue: v[0] })}
      />
      <span className="text-xs text-(--ink-muted) tabular-nums w-6 text-right">
        {dialog.nValue}
      </span>
    </div>
  );
}

export const DropFramesDialog: React.FC<DropFramesDialogProps> = ({
  dialog,
  stats,
  onChange,
  onApply,
  onClose,
}) => (
  <Dialog
    open={!!dialog}
    onOpenChange={(next) => handleDropDialogOpenChange(next, onClose)}
  >
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Drop frames</DialogTitle>
        <DialogDescription>Pick a pattern. Stats update live.</DialogDescription>
      </DialogHeader>

      {dialog && stats && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="grid grid-cols-2 gap-y-1">
            <span className="text-(--ink-muted) text-xs">Frames</span>
            <span className="tabular-nums">
              {stats.total} → {stats.keptCount}
            </span>
            <span className="text-(--ink-muted) text-xs">Duration</span>
            <span className="tabular-nums">
              {formatDuration(stats.sourceDuration)} →{' '}
              {formatDuration(stats.outDuration)}
            </span>
          </div>

          <DropFrameModeOptions dialog={dialog} onChange={onChange} />
          <DropEveryNControl dialog={dialog} onChange={onChange} />

          <label className="flex items-center gap-2 text-sm cursor-pointer pt-1 border-t border-(--polar-mist)">
            <input
              type="checkbox"
              checked={dialog.keepPlaybackSpeed}
              onChange={(e) =>
                onChange({ ...dialog, keepPlaybackSpeed: e.target.checked })
              }
            />
            Keep the playback speed
          </label>
          <p className="text-[10px] text-(--ink-muted) leading-snug -mt-1 pl-5">
            {getPlaybackSpeedCopy(dialog.keepPlaybackSpeed)}
          </p>
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={onApply} disabled={!dialog || dialog.mode === 'none'}>
          OK
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
