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

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function getConvertedDelayValue(dialog: DelayDialogState, mode: DelayDialogState['mode']): string {
  const numeric = Number(dialog.value);
  if (!isPositiveFinite(numeric)) return getDefaultDelayValue(mode);

  const value = dialog.mode === mode ? numeric : 1 / numeric;
  return formatDelayValue(value, mode);
}

function getWheelDelayValue(dialog: DelayDialogState, deltaY: number): string | null {
  const current = Number(dialog.value);
  if (!Number.isFinite(current)) return null;

  const next = Math.max(0.001, current + getWheelDelayStep(dialog.mode) * getWheelDirection(deltaY));
  return formatDelayValue(next, dialog.mode);
}

function getDefaultDelayValue(mode: DelayDialogState['mode']) {
  return mode === 'fps' ? '30' : '0.030';
}

function formatDelayValue(value: number, mode: DelayDialogState['mode']) {
  return mode === 'fps' ? value.toFixed(0) : value.toFixed(3);
}

function getWheelDelayStep(mode: DelayDialogState['mode']) {
  return mode === 'fps' ? 1 : 0.001;
}

function getWheelDirection(deltaY: number) {
  return deltaY < 0 ? 1 : -1;
}

function getDelayInputConfig(mode: DelayDialogState['mode']) {
  return mode === 'fps'
    ? { step: 1, min: 1, max: 1000, unit: 'fps' }
    : { step: 0.001, min: 0.001, max: 60, unit: 'sec' };
}

function getDelayDescription(dialog: DelayDialogState | null): string {
  return dialog && dialog.rowIds.length > 1
    ? `Applies to ${dialog.rowIds.length} frames.`
    : 'Applies to the selected frame.';
}

function DelayModeOption({
  dialog,
  mode,
  label,
  onChange,
}: {
  dialog: DelayDialogState;
  mode: DelayDialogState['mode'];
  label: string;
  onChange: DelayDialogProps['onChange'];
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        type="radio"
        name="delay-mode"
        checked={dialog.mode === mode}
        onChange={() => onChange({ ...dialog, mode, value: getConvertedDelayValue(dialog, mode) })}
      />
      {label}
    </label>
  );
}

function DelayDialogBody({
  dialog,
  onChange,
  onCommit,
}: {
  dialog: DelayDialogState;
  onChange: DelayDialogProps['onChange'];
  onCommit: DelayDialogProps['onCommit'];
}) {
  const inputConfig = getDelayInputConfig(dialog.mode);
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      // Ctrl + wheel for fine-tuned adjustment, matching Honeycam's UX.
      if (!e.ctrlKey) return;
      e.preventDefault();
      const value = getWheelDelayValue(dialog, e.deltaY);
      if (value) {
        onChange({ ...dialog, value });
      }
    },
    [dialog, onChange],
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <DelayModeOption dialog={dialog} mode="sec" label="Seconds" onChange={onChange} />
        <DelayModeOption dialog={dialog} mode="fps" label="FPS" onChange={onChange} />
      </div>

      <div className="flex items-center gap-2">
        <Input
          type="number"
          autoFocus
          step={inputConfig.step}
          min={inputConfig.min}
          max={inputConfig.max}
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
        <span className="text-sm text-(--ink-muted) w-12">{inputConfig.unit}</span>
      </div>

      <p className="text-xs text-(--ink-muted)">
        Hold Ctrl and use the mouse wheel for fine adjustment.
      </p>
    </div>
  );
}

export const DelayDialog: React.FC<DelayDialogProps> = ({
  dialog,
  onChange,
  onCommit,
  onClose,
}) => {
  const handleOpenChange = useCallback((next: boolean) => {
    if (!next) onClose();
  }, [onClose]);

  return (
    <Dialog
      open={!!dialog?.open}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Set frame delay</DialogTitle>
          <DialogDescription>{getDelayDescription(dialog)}</DialogDescription>
        </DialogHeader>

        {dialog && (
          <DelayDialogBody dialog={dialog} onChange={onChange} onCommit={onCommit} />
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
