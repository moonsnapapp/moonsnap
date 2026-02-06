/**
 * KeyboardShortcutsDialog - Modal showing all editor keyboard shortcuts.
 */

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TOOL_SHORTCUTS = [
  { key: 'V', action: 'Select' },
  { key: 'C', action: 'Crop' },
  { key: 'A', action: 'Arrow' },
  { key: 'L', action: 'Line' },
  { key: 'R', action: 'Rectangle' },
  { key: 'E', action: 'Circle' },
  { key: 'T', action: 'Text' },
  { key: 'H', action: 'Highlight' },
  { key: 'B', action: 'Blur' },
  { key: 'S', action: 'Steps' },
  { key: 'P', action: 'Pen' },
  { key: 'G', action: 'Background' },
];

const ACTION_SHORTCUTS = [
  { key: 'Ctrl+Z', action: 'Undo' },
  { key: 'Ctrl+Y', action: 'Redo' },
  { key: 'Ctrl+E', action: 'Save' },
  { key: 'Ctrl+C', action: 'Copy' },
  { key: 'Esc', action: 'Deselect' },
  { key: 'F', action: 'Fit to center' },
  { key: '?', action: 'Show shortcuts' },
];

function ShortcutRow({ shortcut }: { shortcut: { key: string; action: string } }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-xs text-[var(--ink-muted)]">{shortcut.action}</span>
      <kbd className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-[var(--polar-mist)] text-[var(--ink-dark)] border border-[var(--polar-frost)]">
        {shortcut.key}
      </kbd>
    </div>
  );
}

export const KeyboardShortcutsDialog: React.FC<KeyboardShortcutsDialogProps> = ({
  open,
  onOpenChange,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Quick keys for the image editor
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-8 gap-y-0">
          {/* Tools column */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-2">
              Tools
            </h4>
            {TOOL_SHORTCUTS.map((s) => (
              <ShortcutRow key={s.key} shortcut={s} />
            ))}
          </div>

          {/* Actions column */}
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-[var(--ink-subtle)] mb-2">
              Actions
            </h4>
            {ACTION_SHORTCUTS.map((s) => (
              <ShortcutRow key={s.key} shortcut={s} />
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
