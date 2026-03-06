import React from 'react';
import { ZoomIn, ZoomOut, Maximize2, Square } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ZoomControlsProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFitToSize: () => void;
  onActualSize: () => void;
  /** When true, shift left to make room for crop controls */
  cropActive?: boolean;
}

/**
 * Zoom control buttons - bottom center
 */
export const ZoomControls: React.FC<ZoomControlsProps> = React.memo(({
  zoom,
  onZoomIn,
  onZoomOut,
  onFitToSize,
  onActualSize,
  cropActive = false,
}) => {
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <div
        className="absolute bottom-4 flex items-center gap-1 bg-[var(--card)] rounded-xl p-1 border border-[var(--polar-frost)] shadow-lg z-10 transition-all duration-200 ease-out"
        style={{
          left: cropActive ? 'calc(50% - 0.5rem)' : '50%',
          transform: cropActive ? 'translateX(-100%)' : 'translateX(-50%)',
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onZoomOut}
              className="p-1.5 hover:bg-[var(--polar-ice)] rounded-lg transition-colors"
            >
              <ZoomOut size={16} className="text-[var(--ink-muted)]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">Zoom Out</span>
          </TooltipContent>
        </Tooltip>
        <span className="px-2 text-xs text-[var(--ink-muted)] min-w-[3rem] text-center font-medium">
          {Math.round(zoom * 100)}%
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onZoomIn}
              className="p-1.5 hover:bg-[var(--polar-ice)] rounded-lg transition-colors"
            >
              <ZoomIn size={16} className="text-[var(--ink-muted)]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">Zoom In</span>
          </TooltipContent>
        </Tooltip>
        <div className="w-px h-4 bg-[var(--polar-frost)] mx-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onFitToSize}
              className="p-1.5 hover:bg-[var(--polar-ice)] rounded-lg transition-colors"
            >
              <Maximize2 size={16} className="text-[var(--ink-muted)]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <div className="flex items-center gap-2">
              <span className="text-xs">Fit to Window</span>
              <kbd className="kbd text-[10px] px-1.5 py-0.5">F</kbd>
            </div>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onActualSize}
              className="p-1.5 hover:bg-[var(--polar-ice)] rounded-lg transition-colors"
            >
              <Square size={16} className="text-[var(--ink-muted)]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <span className="text-xs">Actual Size (100%)</span>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
});

ZoomControls.displayName = 'ZoomControls';
