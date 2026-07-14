import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Folder as FolderIcon, FolderPlus, Images, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { reportError } from '../../../utils/errorReporting';
import { useCaptureStore, useFolderCounts } from '../../../stores/captureStore';
import { ROOT_DROP_TARGET_KEY } from '../hooks';
import type { Folder } from '../../../types';

function FolderNameInput({
  initialValue,
  placeholder,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  placeholder: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onCommit(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={onCancel}
      placeholder={placeholder}
      aria-label={placeholder}
      className="folder-rail__input"
    />
  );
}

function FolderRailItem({
  icon,
  label,
  count,
  active,
  isDropTarget,
  dropTargetKey,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  isDropTarget: boolean;
  dropTargetKey: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-folder-drop-target={dropTargetKey}
      className={`folder-rail__item ${active ? 'folder-rail__item--active' : ''} ${
        isDropTarget ? 'folder-rail__item--drop' : ''
      }`}
    >
      {icon}
      <span className="folder-rail__label">{label}</span>
      <span className="folder-rail__count">{count}</span>
    </button>
  );
}

function FolderRow({
  folder,
  count,
  active,
  isDropTarget,
  isRenaming,
  onSelect,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
}: {
  folder: Folder;
  count: number;
  active: boolean;
  isDropTarget: boolean;
  isRenaming: boolean;
  onSelect: () => void;
  onStartRename: () => void;
  onCommitRename: (name: string) => void;
  onCancelRename: () => void;
  onDelete: () => void;
}) {
  if (isRenaming) {
    return (
      <div className="folder-rail__item folder-rail__item--editing">
        <FolderIcon className="w-4 h-4 shrink-0" />
        <FolderNameInput
          initialValue={folder.name}
          placeholder="Folder name"
          onCommit={onCommitRename}
          onCancel={onCancelRename}
        />
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div>
          <FolderRailItem
            icon={<FolderIcon className="w-4 h-4 shrink-0" />}
            label={folder.name}
            count={count}
            active={active}
            isDropTarget={isDropTarget}
            dropTargetKey={folder.id}
            onClick={onSelect}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartRename}>
          <Pencil className="w-4 h-4 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onClick={onDelete}
          className="text-red-500 focus:text-red-500 focus:bg-red-50"
        >
          <Trash2 className="w-4 h-4 mr-2" />
          Delete Folder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/**
 * Left navigation rail for the full library view: All Items plus the user's
 * folders. Folders are pure metadata — deleting one returns its captures to
 * the root library.
 */
export const FolderSidebar: React.FC<{ dropTargetKey?: string | null }> = ({
  dropTargetKey = null,
}) => {
  const folders = useCaptureStore((state) => state.folders);
  const activeFolderId = useCaptureStore((state) => state.activeFolderId);
  const totalCaptureCount = useCaptureStore((state) => state.captures.length);
  const setActiveFolder = useCaptureStore((state) => state.setActiveFolder);
  const createFolder = useCaptureStore((state) => state.createFolder);
  const renameFolder = useCaptureStore((state) => state.renameFolder);
  const deleteFolder = useCaptureStore((state) => state.deleteFolder);
  const folderCounts = useFolderCounts();

  const [isCreating, setIsCreating] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [folderPendingDelete, setFolderPendingDelete] = useState<Folder | null>(null);

  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));
  const pendingDeleteCount = folderPendingDelete
    ? folderCounts.get(folderPendingDelete.id) ?? 0
    : 0;

  const handleCreate = async (name: string) => {
    setIsCreating(false);
    try {
      const folder = await createFolder(name);
      setActiveFolder(folder.id);
    } catch (error) {
      reportError(error, { operation: 'create folder' });
      toast.error('Failed to create folder');
    }
  };

  const handleRename = async (folderId: string, name: string) => {
    setRenamingFolderId(null);
    try {
      await renameFolder(folderId, name);
    } catch (error) {
      reportError(error, { operation: 'rename folder' });
      toast.error('Failed to rename folder');
    }
  };

  const handleConfirmDelete = async () => {
    const folder = folderPendingDelete;
    setFolderPendingDelete(null);
    if (!folder) return;

    try {
      await deleteFolder(folder.id);
      toast.success(`Deleted "${folder.name}" — its captures are back in the library`);
    } catch (error) {
      reportError(error, { operation: 'delete folder' });
      toast.error('Failed to delete folder');
    }
  };

  return (
    <aside className="folder-rail" aria-label="Library folders">
      <FolderRailItem
        icon={<Images className="w-4 h-4 shrink-0" />}
        label="All Items"
        count={totalCaptureCount}
        active={activeFolderId === null}
        isDropTarget={dropTargetKey === ROOT_DROP_TARGET_KEY}
        dropTargetKey={ROOT_DROP_TARGET_KEY}
        onClick={() => setActiveFolder(null)}
      />

      <div className="folder-rail__section">
        <span className="folder-rail__section-title">Folders</span>
        <button
          type="button"
          onClick={() => setIsCreating(true)}
          aria-label="New folder"
          title="New folder"
          className="folder-rail__add"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="folder-rail__list">
        {sortedFolders.map((folder) => (
          <FolderRow
            key={folder.id}
            folder={folder}
            count={folderCounts.get(folder.id) ?? 0}
            active={activeFolderId === folder.id}
            isDropTarget={dropTargetKey === folder.id}
            isRenaming={renamingFolderId === folder.id}
            onSelect={() => setActiveFolder(folder.id)}
            onStartRename={() => setRenamingFolderId(folder.id)}
            onCommitRename={(name) => handleRename(folder.id, name)}
            onCancelRename={() => setRenamingFolderId(null)}
            onDelete={() => setFolderPendingDelete(folder)}
          />
        ))}

        {isCreating && (
          <div className="folder-rail__item folder-rail__item--editing">
            <FolderIcon className="w-4 h-4 shrink-0" />
            <FolderNameInput
              initialValue=""
              placeholder="New folder"
              onCommit={handleCreate}
              onCancel={() => setIsCreating(false)}
            />
          </div>
        )}

        {!isCreating && sortedFolders.length === 0 && (
          <p className="folder-rail__empty">
            Create folders to organize your captures into projects.
          </p>
        )}
      </div>

      <AlertDialog
        open={folderPendingDelete !== null}
        onOpenChange={(open) => !open && setFolderPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-500" />
              Delete Folder
            </AlertDialogTitle>
            <AlertDialogDescription>
              Delete &ldquo;{folderPendingDelete?.name}&rdquo;?
              {pendingDeleteCount > 0
                ? ` Its ${pendingDeleteCount} capture${pendingDeleteCount === 1 ? '' : 's'} will move back to the library.`
                : ' No captures will be affected.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setFolderPendingDelete(null)}
              className="editor-choice-pill mt-0 h-auto px-4 py-2 text-sm font-medium"
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDelete}
              className="editor-choice-pill editor-choice-pill--danger h-auto px-4 py-2 text-sm font-medium"
            >
              Delete Folder
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
};
