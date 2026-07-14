import React from 'react';
import { Star, Trash2, Copy, ExternalLink, Play, Tag, Film, Wrench, Download, Folder, FolderMinus, FolderPlus, Check } from 'lucide-react';
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { useCaptureStore } from '../../../stores/captureStore';

interface CaptureContextMenuProps {
  favorite: boolean;
  isMissing?: boolean;
  captureType?: string;
  quickCapture?: boolean;
  currentFolderId?: string | null;
  onCopyToClipboard: () => void;
  onOpenInFolder: () => void;
  onToggleFavorite: () => void;
  onManageTags?: () => void;
  onMoveToFolder?: (folderId: string | null) => void;
  onMoveToNewFolder?: () => void;
  onDelete: () => void;
  onPlayMedia?: () => void;
  onEditVideo?: () => void;
  onSaveCopy?: () => void;
  damaged?: boolean;
  onRepair?: () => void;
}

// Check if capture is a video or gif
const isMediaType = (type?: string) => type === 'video' || type === 'gif';

function MissingAwareMenuItem({
  isMissing,
  onClick,
  children,
}: {
  isMissing: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <ContextMenuItem
      onClick={onClick}
      disabled={isMissing}
      className={isMissing ? 'opacity-50 cursor-not-allowed' : ''}
    >
      {children}
    </ContextMenuItem>
  );
}

function MoveToFolderSubmenu({
  currentFolderId,
  onMoveToFolder,
  onMoveToNewFolder,
}: {
  currentFolderId: string | null;
  onMoveToFolder: (folderId: string | null) => void;
  onMoveToNewFolder?: () => void;
}) {
  const folders = useCaptureStore((state) => state.folders);
  const sortedFolders = [...folders].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <Folder className="w-4 h-4 mr-2" />
        Move to Folder
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {sortedFolders.map((folder) => (
          <ContextMenuItem
            key={folder.id}
            onClick={() => onMoveToFolder(folder.id)}
            disabled={folder.id === currentFolderId}
          >
            <Folder className="w-4 h-4 mr-2" />
            <span className="truncate max-w-[180px]">{folder.name}</span>
            {folder.id === currentFolderId && <Check className="w-3.5 h-3.5 ml-auto pl-1" />}
          </ContextMenuItem>
        ))}
        {onMoveToNewFolder && (
          <>
            {sortedFolders.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onClick={onMoveToNewFolder}>
              <FolderPlus className="w-4 h-4 mr-2" />
              New Folder…
            </ContextMenuItem>
          </>
        )}
        {currentFolderId !== null && (
          <ContextMenuItem onClick={() => onMoveToFolder(null)}>
            <FolderMinus className="w-4 h-4 mr-2" />
            Remove from Folder
          </ContextMenuItem>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

export const CaptureContextMenu: React.FC<CaptureContextMenuProps> = ({
  favorite,
  isMissing = false,
  captureType,
  quickCapture = false,
  currentFolderId = null,
  onCopyToClipboard,
  onOpenInFolder,
  onToggleFavorite,
  onManageTags,
  onMoveToFolder,
  onMoveToNewFolder,
  onDelete,
  onPlayMedia,
  onEditVideo,
  onSaveCopy,
  damaged = false,
  onRepair,
}) => {
  const isMedia = isMediaType(captureType);
  const isVideo = captureType === 'video';
  const canPlayMedia = isMedia && (quickCapture || captureType === 'gif') && onPlayMedia;
  const canEditVideo = isVideo && onEditVideo;

  return (
    <ContextMenuContent>
      {canPlayMedia && (
        <MissingAwareMenuItem isMissing={isMissing} onClick={onPlayMedia}>
          <Play className="w-4 h-4 mr-2" />
          Play {captureType === 'gif' ? 'GIF' : 'Video'}
        </MissingAwareMenuItem>
      )}
      {canEditVideo && (
        <MissingAwareMenuItem isMissing={isMissing} onClick={onEditVideo}>
          <Film className="w-4 h-4 mr-2" />
          {quickCapture ? 'Open as Project' : 'Edit Video'}
        </MissingAwareMenuItem>
      )}
      {onSaveCopy && (
        <MissingAwareMenuItem isMissing={isMissing} onClick={onSaveCopy}>
          <Download className="w-4 h-4 mr-2" />
          Save As
        </MissingAwareMenuItem>
      )}
      {damaged && onRepair && (
        <ContextMenuItem onClick={onRepair}>
          <Wrench className="w-4 h-4 mr-2" />
          Repair Project
        </ContextMenuItem>
      )}
      {!isMedia && (
        <MissingAwareMenuItem isMissing={isMissing} onClick={onCopyToClipboard}>
          <Copy className="w-4 h-4 mr-2" />
          Copy to Clipboard
        </MissingAwareMenuItem>
      )}
      <ContextMenuItem onClick={onOpenInFolder}>
        <ExternalLink className="w-4 h-4 mr-2" />
        Show in Folder
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={onToggleFavorite}>
        <Star className="w-4 h-4 mr-2" fill={favorite ? 'currentColor' : 'none'} />
        {favorite ? 'Remove from Favorites' : 'Add to Favorites'}
      </ContextMenuItem>
      {onManageTags && (
        <ContextMenuItem onClick={onManageTags}>
          <Tag className="w-4 h-4 mr-2" />
          Manage Tags
        </ContextMenuItem>
      )}
      {onMoveToFolder && (
        <MoveToFolderSubmenu
          currentFolderId={currentFolderId}
          onMoveToFolder={onMoveToFolder}
          onMoveToNewFolder={onMoveToNewFolder}
        />
      )}
      <ContextMenuSeparator />
      <ContextMenuItem
        onClick={onDelete}
        className="text-red-500 focus:text-red-500 focus:bg-red-50"
      >
        <Trash2 className="w-4 h-4 mr-2" />
        {isMissing ? 'Remove Entry' : 'Delete'}
        <ContextMenuShortcut>Del</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  );
};
