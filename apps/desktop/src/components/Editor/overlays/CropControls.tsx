import React from 'react';
import { Check, X, RotateCcw } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface CropControlsProps {
  width: number;
  height: number;
  isModified: boolean;
  onCancel: () => void;
  onReset: () => void;
  onCommit: () => void;
}

/**
 * Crop control buttons - bottom center
 * Shows dimensions and action buttons during crop mode
 */
export const CropControls: React.FC<CropControlsProps> = React.memo(({
  width,
  height,
  isModified,
  onCancel,
  onReset,
  onCommit,
}) => {
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <div className="absolute bottom-4 flex items-center gap-1 bg-[var(--card)] rounded-xl p-1 border border-[var(--polar-frost)] shadow-lg z-10 animate-in fade-in slide-in-from-right-4 duration-200" style={{ left: 'calc(50% + 0.5rem)' }}>
        <span className="text-xs text-[var(--ink-muted)] px-2 font-mono">
          {Math.round(width)} × {Math.round(height)}
        </span>
        <div className="w-px h-4 bg-[var(--polar-frost)] mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCancel}
              className="p-1.5 hover:bg-red-500/30 bg-red-500/20 rounded-lg transition-colors"
            >
              <X size={16} className="text-red-400" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex items-center gap-2">
              <span className="text-xs">Cancel</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Esc</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
        {isModified && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onReset}
                className="p-1.5 hover:bg-amber-500/30 bg-amber-500/20 rounded-lg transition-colors"
              >
                <RotateCcw size={16} className="text-amber-400" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <span className="text-xs">Reset to minimum bounds</span>
            </TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onCommit}
              className="p-1.5 hover:bg-emerald-500/30 bg-emerald-500/20 rounded-lg transition-colors"
            >
              <Check size={16} className="text-emerald-400" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex items-center gap-2">
              <span className="text-xs">Apply Crop</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">Enter</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
});

CropControls.displayName = 'CropControls';
