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
  Lock,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import type { Tool } from '../../types';
import { useEditorStore } from '../../stores/editorStore';
import { useLicenseStore } from '../../stores/licenseStore';
import { LICENSE, TIMING } from '../../constants';

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

const PRO_TOOLS: Set<Tool> = new Set(['background']);

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
  const [isCompact, setIsCompact] = useState(false);

  // Get undo/redo state from store
  const canUndo = useEditorStore((state) => state.canUndo);
  const canRedo = useEditorStore((state) => state.canRedo);
  const isPro = useLicenseStore((s) => s.isPro());

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

  const handleCopy = async () => {
    await onCopy();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const buttonSize = isCompact ? 'h-8 w-8' : 'h-9 w-9';
  const iconSize = isCompact ? 'w-4 h-4' : 'w-[18px] h-[18px]';

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <div className="editor-toolbar-container">
        <div className="floating-toolbar animate-scale-in">
          {/* Undo/Redo Buttons */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onUndo}
                disabled={!canUndo}
                aria-label="Undo"
                className={`glass-btn ${buttonSize} disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                <Undo2 className={iconSize} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span className="text-xs">Undo</span>
                <kbd className="kbd text-[10px] px-1.5 py-0.5">Ctrl+Z</kbd>
              </div>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                aria-label="Redo"
                className={`glass-btn ${buttonSize} disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                <Redo2 className={iconSize} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span className="text-xs">Redo</span>
                <kbd className="kbd text-[10px] px-1.5 py-0.5">Ctrl+Y</kbd>
              </div>
            </TooltipContent>
          </Tooltip>

          <div className="toolbar-divider" />

          {/* Tool Buttons */}
          <div className="flex items-center gap-0.5">
            {toolDefs.map((tool) => {
              const needsPro = !isPro && PRO_TOOLS.has(tool.id);
              return (
                <Tooltip key={tool.id}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => {
                        if (needsPro) {
                          window.open(LICENSE.PURCHASE_URL, '_blank');
                          return;
                        }
                        onToolChange(tool.id);
                      }}
                      aria-label={tool.label}
                      className={`tool-button ${buttonSize} ${selectedTool === tool.id ? 'active' : ''} ${needsPro ? 'opacity-50' : ''}`}
                    >
                      <tool.Icon className={`${iconSize} relative z-10`} />
                      {needsPro && <Lock size={8} className="absolute top-0.5 right-0.5 opacity-60" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <div className="flex items-center gap-2">
                      <span className="text-xs">{needsPro ? `${tool.label} (Pro)` : tool.label}</span>
                      <kbd className="kbd text-[10px] px-1.5 py-0.5">{tool.shortcut}</kbd>
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          <div className="toolbar-divider" />

          {/* Quick Copy Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleCopy}
                disabled={isCopying}
                aria-label="Copy to clipboard"
                className={`glass-btn ${buttonSize} ${
                  copied ? 'glass-btn--success' : ''
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {isCopying ? (
                  <Loader2 className={`${iconSize} animate-spin`} />
                ) : copied ? (
                  <Check className={`${iconSize} animate-scale-in`} />
                ) : (
                  <Copy className={iconSize} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span className="text-xs">{isCopying ? 'Copying...' : copied ? 'Copied!' : 'Copy'}</span>
                <kbd className="kbd text-[10px] px-1.5 py-0.5">Ctrl+C</kbd>
              </div>
            </TooltipContent>
          </Tooltip>

          {/* Save Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onSave}
                disabled={isSaving}
                aria-label="Save to File"
                className={`glass-btn ${buttonSize} disabled:opacity-50`}
              >
                {isSaving ? (
                  <Loader2 className={`${iconSize} animate-spin`} />
                ) : (
                  <Save className={iconSize} />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <div className="flex items-center gap-2">
                <span className="text-xs">{isSaving ? 'Saving...' : 'Save to File'}</span>
                <kbd className="kbd text-[10px] px-1.5 py-0.5">Ctrl+E</kbd>
              </div>
            </TooltipContent>
          </Tooltip>

          {/* Delete Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onDelete}
                aria-label="Delete capture"
                className={`glass-btn glass-btn--danger ${buttonSize}`}
              >
                <Trash2 className={iconSize} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Delete Capture</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  );
};
