import React, { useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { DelayDialogState } from './types';

interface DelayDialogProps {
  dialog: DelayDialogState | null;
  onChange: (next: DelayDialogState) => void;
  onCommit: () => void;
  onClose: () => void;
}

export const DelayDialog: React.FC<DelayDialogProps> = ({
  dialog,
  onChange,
  onCommit,
  onClose,
}) => {
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Ctrl + wheel for fine-tuned adjustment, matching Honeycam's UX.
      if (!e.ctrlKey || !dialog) return;
      e.preventDefault();
      const current = Number(dialog.value);
      if (!Number.isFinite(current)) return;
      const step = dialog.mode === 'fps' ? 1 : 0.001;
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.max(0.001, current + step * dir);
      onChange({
        ...dialog,
        value: dialog.mode === 'fps' ? next.toFixed(0) : next.toFixed(3),
      });
    },
    [dialog, onChange],
  );

  return (
    <Dialog
      open={!!dialog?.open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set frame delay</DialogTitle>
          <DialogDescription>
            {dialog && dialog.rowIds.length > 1
              ? `Applies to ${dialog.rowIds.length} frames.`
              : 'Applies to the selected frame.'}
          </DialogDescription>
        </DialogHeader>

        {dialog && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="delay-mode"
                  checked={dialog.mode === 'sec'}
                  onChange={() => {
                    const numeric = Number(dialog.value);
                    const newValue =
                      Number.isFinite(numeric) && numeric > 0
                        ? (dialog.mode === 'fps' ? 1 / numeric : numeric).toFixed(3)
                        : '0.030';
                    onChange({ ...dialog, mode: 'sec', value: newValue });
                  }}
                />
                Seconds
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="delay-mode"
                  checked={dialog.mode === 'fps'}
                  onChange={() => {
                    const numeric = Number(dialog.value);
                    const newValue =
                      Number.isFinite(numeric) && numeric > 0
                        ? (dialog.mode === 'sec' ? 1 / numeric : numeric).toFixed(0)
                        : '30';
                    onChange({ ...dialog, mode: 'fps', value: newValue });
                  }}
                />
                FPS
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Input
                type="number"
                autoFocus
                step={dialog.mode === 'fps' ? 1 : 0.001}
                min={dialog.mode === 'fps' ? 1 : 0.001}
                max={dialog.mode === 'fps' ? 1000 : 60}
                value={dialog.value}
                onChange={(e) => onChange({ ...dialog, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onCommit();
                  }
                }}
                onWheel={handleWheel}
                className="flex-1"
              />
              <span className="text-sm text-(--ink-muted) w-12">
                {dialog.mode === 'fps' ? 'fps' : 'sec'}
              </span>
            </div>

            <p className="text-xs text-(--ink-muted)">
              Hold Ctrl and use the mouse wheel for fine adjustment.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onCommit}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
