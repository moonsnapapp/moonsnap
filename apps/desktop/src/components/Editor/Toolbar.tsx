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

function getCopyButtonLabel(isCopying: boolean, copied: boolean): string {
  if (isCopying) return 'Copying...';
  return copied ? 'Copied!' : 'Copy';
}

function CopyButtonIcon({
  isCopying,
  copied,
  iconSize,
}: {
  isCopying: boolean;
  copied: boolean;
  iconSize: string;
}) {
  if (isCopying) {
    return <Loader2 className={`${iconSize} animate-spin`} />;
  }

  if (copied) {
    return <Check className={`${iconSize} animate-scale-in`} />;
  }

  return <Copy className={iconSize} />;
}

function SaveButtonIcon({ isSaving, iconSize }: { isSaving: boolean; iconSize: string }) {
  if (isSaving) {
    return <Loader2 className={`${iconSize} animate-spin`} />;
  }

  return <Save className={iconSize} />;
}

function getSaveButtonLabel(isSaving: boolean) {
  return isSaving ? 'Saving...' : 'Save to File';
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
            label={getCopyButtonLabel(isCopying, copied)}
            shortcut="Ctrl+C"
            onClick={handleCopy}
            disabled={isCopying}
            className={`glass-btn ${buttonSize} ${
              copied ? 'glass-btn--success' : ''
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            <CopyButtonIcon isCopying={isCopying} copied={copied} iconSize={iconSize} />
          </ToolbarIconButton>

          {/* Save Button */}
          <ToolbarIconButton
            label={getSaveButtonLabel(isSaving)}
            shortcut="Ctrl+E"
            onClick={onSave}
            disabled={isSaving}
            className={`glass-btn ${buttonSize} disabled:opacity-50`}
          >
            <SaveButtonIcon isSaving={isSaving} iconSize={iconSize} />
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
