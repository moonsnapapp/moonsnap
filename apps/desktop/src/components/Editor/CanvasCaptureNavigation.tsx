import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface CaptureNavigationControls {
  canGoPrevious: boolean;
  canGoNext: boolean;
  onGoPrevious?: () => void;
  onGoNext?: () => void;
}

export const CanvasCaptureNavigation: React.FC<CaptureNavigationControls> = ({
  canGoPrevious,
  canGoNext,
  onGoPrevious,
  onGoNext,
}) => {
  if (!canGoPrevious && !canGoNext) {
    return null;
  }

  const stopCanvasGesture = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
  };

  return (
    <div className="canvas-capture-nav" aria-label="Capture navigation">
      {canGoPrevious && (
        <button
          type="button"
          className="canvas-capture-nav__button canvas-capture-nav__button--previous"
          aria-label="Previous capture"
          onMouseDown={stopCanvasGesture}
          onClick={(event) => {
            event.stopPropagation();
            onGoPrevious?.();
          }}
        >
          <ChevronLeft aria-hidden="true" />
        </button>
      )}
      {canGoNext && (
        <button
          type="button"
          className="canvas-capture-nav__button canvas-capture-nav__button--next"
          aria-label="Next capture"
          onMouseDown={stopCanvasGesture}
          onClick={(event) => {
            event.stopPropagation();
            onGoNext?.();
          }}
        >
          <ChevronRight aria-hidden="true" />
        </button>
      )}
    </div>
  );
};
