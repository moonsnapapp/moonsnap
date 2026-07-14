import React, { useEffect, useState } from 'react';
import { FolderPlus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface NewFolderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string) => void;
}

/** Prompt for a folder name, used by the capture context menu's New Folder flow */
export const NewFolderDialog: React.FC<NewFolderDialogProps> = ({
  open,
  onOpenChange,
  onCreate,
}) => {
  const [name, setName] = useState('');

  useEffect(() => {
    if (open) setName('');
  }, [open]);

  const trimmedName = name.trim();
  const submit = () => {
    if (trimmedName) onCreate(trimmedName);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[380px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderPlus className="w-5 h-5 text-[var(--accent-400)]" />
            New Folder
          </DialogTitle>
          <DialogDescription>
            The selected captures will be moved into the new folder.
          </DialogDescription>
        </DialogHeader>
        <Input
          value={name}
          autoFocus
          placeholder="Folder name"
          aria-label="Folder name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="editor-choice-pill mt-0 h-auto px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!trimmedName}
            className="editor-choice-pill editor-choice-pill--active h-auto px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:pointer-events-none"
          >
            Create &amp; Move
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
