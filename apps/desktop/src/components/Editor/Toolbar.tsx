import {
  MousePointer2,
  MoveUpRight,
  Minus,
  Square,
  Circle,
  Type,
  Highlighter,
  Droplet,
  Hash,
  Copy,
  Check,
  Undo2,
  Redo2,
  Sparkles,
  Crop,
  Loader2,
  Pencil,
  Save,
  Trash2,
} from 'lucide-react';
import { useState, useEffect, type ReactNode } from 'react';
import type { Tool } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { TIMING } from '../../constants';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
interface ToolbarProps {
  selectedTool: Tool;
  onToolChange: (tool: Tool) => void;
  onCopy: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  isCopying?: boolean;
  isSaving?: boolean;
}

const toolDefs: { id: Tool; Icon: typeof MousePointer2; label: string; shortcut: string }[] = [
  { id: 'select', Icon: MousePointer2, label: 'Select', shortcut: 'V' },
  { id: 'crop', Icon: Crop, label: 'Crop/Expand', shortcut: 'C' },
  { id: 'arrow', Icon: MoveUpRight, label: 'Arrow', shortcut: 'A' },
  { id: 'line', Icon: Minus, label: 'Line', shortcut: 'L' },
  { id: 'rect', Icon: Square, label: 'Rectangle', shortcut: 'R' },
  { id: 'circle', Icon: Circle, label: 'Ellipse', shortcut: 'E' },
  { id: 'text', Icon: Type, label: 'Text', shortcut: 'T' },
  { id: 'highlight', Icon: Highlighter, label: 'Highlight', shortcut: 'H' },
  { id: 'blur', Icon: Droplet, label: 'Blur', shortcut: 'B' },
  { id: 'steps', Icon: Hash, label: 'Steps', shortcut: 'S' },
  { id: 'pen', Icon: Pencil, label: 'Pen', shortcut: 'P' },
  { id: 'background', Icon: Sparkles, label: 'Background', shortcut: 'G' },
];

function ToolbarTooltipContent({
  label,
  shortcut,
}: {
  label: string;
  shortcut?: string;
}) {
  if (!shortcut) {
    return <p className="text-xs">{label}</p>;
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs">{label}</span>
      <kbd className="kbd text-[10px] px-1.5 py-0.5">{shortcut}</kbd>
    </div>
  );
}

function ToolbarIconButton({
  label,
  shortcut,
  className,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  className: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
          className={className}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <ToolbarTooltipContent label={label} shortcut={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

function ToolButton({
  tool,
  selectedTool,
  buttonSize,
  iconSize,
  onToolChange,
}: {
  tool: typeof toolDefs[number];
  selectedTool: Tool;
  buttonSize: string;
  iconSize: string;
  onToolChange: (tool: Tool) => void;
}) {
  return (
    <ToolbarIconButton
      label={tool.label}
      shortcut={tool.shortcut}
      className={`tool-button ${buttonSize} ${selectedTool === tool.id ? 'active' : ''}`}
      onClick={() => onToolChange(tool.id)}
    >
      <tool.Icon className={`${iconSize} relative z-10`} />
    </ToolbarIconButton>
  );
}

type CopyState = 'idle' | 'copying' | 'copied';
type SaveState = 'idle' | 'saving';

function getCopyButtonLabel(state: CopyState): string {
  switch (state) {
    case 'copying':
      return 'Copying...';
    case 'copied':
      return 'Copied!';
    default:
      return 'Copy';
  }
}

function CopyButtonIcon({
  state,
  iconSize,
}: {
  state: CopyState;
  iconSize: string;
}) {
  switch (state) {
    case 'copying':
      return <Loader2 className={`${iconSize} animate-spin`} />;
    case 'copied':
      return <Check className={`${iconSize} animate-scale-in`} />;
    default:
      return <Copy className={iconSize} />;
  }
}

function SaveButtonIcon({ state, iconSize }: { state: SaveState; iconSize: string }) {
  if (state === 'saving') {
    return <Loader2 className={`${iconSize} animate-spin`} />;
  }

  return <Save className={iconSize} />;
}

function getSaveButtonLabel(state: SaveState) {
  return state === 'saving' ? 'Saving...' : 'Save to File';
}

function getToolbarButtonSize(isCompact: boolean) {
  return isCompact ? 'h-8 w-8' : 'h-9 w-9';
}

function getToolbarIconSize(isCompact: boolean) {
  return isCompact ? 'w-4 h-4' : 'w-[18px] h-[18px]';
}

function useToolbarCompactMode() {
  const [isCompact, setIsCompact] = useState(false);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const checkSize = () => {
      setIsCompact(window.innerWidth < 720 || window.innerHeight < 500);
    };
    const debouncedCheck = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(checkSize, TIMING.RESIZE_DEBOUNCE_MS);
    };
    checkSize();
    window.addEventListener('resize', debouncedCheck);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('resize', debouncedCheck);
    };
  }, []);

  return isCompact;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  selectedTool,
  onToolChange,
  onCopy,
  onSave,
  onUndo,
  onRedo,
  onDelete,
  isCopying = false,
  isSaving = false,
}) => {
  const [copied, setCopied] = useState(false);
  const isCompact = useToolbarCompactMode();

  // Get undo/redo state from store
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Collapse the overlapping copy/save flags into explicit states so the
  // impossible combinations (e.g. copying + copied) can't be represented.
  const copyState: CopyState = isCopying ? 'copying' : copied ? 'copied' : 'idle';
  const saveState: SaveState = isSaving ? 'saving' : 'idle';

  const buttonSize = getToolbarButtonSize(isCompact);
  const iconSize = getToolbarIconSize(isCompact);

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <div className="editor-toolbar-container">
        <div className="floating-toolbar animate-scale-in">
          {/* Undo/Redo Buttons */}
          <ToolbarIconButton
            label="Undo"
            shortcut="Ctrl+Z"
            onClick={onUndo}
            disabled={!canUndo}
            className={`glass-btn ${buttonSize} disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <Undo2 className={iconSize} />
          </ToolbarIconButton>

          <ToolbarIconButton
            label="Redo"
            shortcut="Ctrl+Y"
            onClick={onRedo}
            disabled={!canRedo}
            className={`glass-btn ${buttonSize} disabled:opacity-30 disabled:cursor-not-allowed`}
          >
            <Redo2 className={iconSize} />
          </ToolbarIconButton>

          <div className="toolbar-divider" />

          {/* Tool Buttons */}
          <div className="flex items-center gap-0.5">
            {toolDefs.map((tool) => (
              <ToolButton
                key={tool.id}
                tool={tool}
                selectedTool={selectedTool}
                buttonSize={buttonSize}
                iconSize={iconSize}
                onToolChange={onToolChange}
              />
            ))}
          </div>

          <div className="toolbar-divider" />

          {/* Quick Copy Button */}
          <ToolbarIconButton
            label={getCopyButtonLabel(copyState)}
            shortcut="Ctrl+C"
            onClick={handleCopy}
            disabled={copyState === 'copying'}
            className={`glass-btn ${buttonSize} ${
              copyState === 'copied' ? 'glass-btn--success' : ''
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <CopyButtonIcon state={copyState} iconSize={iconSize} />
          </ToolbarIconButton>

          {/* Save Button */}
          <ToolbarIconButton
            label={getSaveButtonLabel(saveState)}
            shortcut="Ctrl+E"
            onClick={onSave}
            disabled={saveState === 'saving'}
            className={`glass-btn ${buttonSize} disabled:opacity-50`}
          >
            <SaveButtonIcon state={saveState} iconSize={iconSize} />
          </ToolbarIconButton>

          {/* Delete Button */}
          <ToolbarIconButton
            label="Delete Capture"
            onClick={onDelete}
            className={`glass-btn glass-btn--danger ${buttonSize}`}
          >
            <Trash2 className={iconSize} />
          </ToolbarIconButton>
        </div>
      </div>
    </TooltipProvider>
  );
};
