import React from 'react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';

export interface CaptureNavigationControls {
  canGoPrevious: boolean;
  canGoNext: boolean;
  onGoPrevious?: () => void;
  onGoNext?: () => void;
}

interface CaptureNavigationButtonProps {
  ariaLabel: string;
  className: string;
  icon: LucideIcon;
  onNavigate?: () => void;
}

type CaptureNavigationItem = CaptureNavigationButtonProps & {
  key: string;
};

const stopCanvasGesture = (event: React.MouseEvent<HTMLButtonElement>) => {
  event.stopPropagation();
};

const CaptureNavigationButton: React.FC<CaptureNavigationButtonProps> = ({
  ariaLabel,
  className,
  icon: Icon,
  onNavigate,
}) => (
  <button
    type="button"
    className={`canvas-capture-nav__button ${className}`}
    aria-label={ariaLabel}
    onMouseDown={stopCanvasGesture}
    onClick={(event) => {
      event.stopPropagation();
      onNavigate?.();
    }}
  >
    <Icon aria-hidden="true" />
  </button>
);

const isCaptureNavigationItem = (
  item: CaptureNavigationItem | null,
): item is CaptureNavigationItem => item !== null;

const getCaptureNavigationItems = ({
  canGoPrevious,
  canGoNext,
  onGoPrevious,
  onGoNext,
}: CaptureNavigationControls): CaptureNavigationItem[] => {
  const items: Array<CaptureNavigationItem | null> = [
    canGoPrevious
      ? {
          key: 'previous',
          ariaLabel: 'Previous capture',
          className: 'canvas-capture-nav__button--previous',
          icon: ChevronLeft,
          onNavigate: onGoPrevious,
        }
      : null,
    canGoNext
      ? {
          key: 'next',
          ariaLabel: 'Next capture',
          className: 'canvas-capture-nav__button--next',
          icon: ChevronRight,
          onNavigate: onGoNext,
        }
      : null,
  ];

  return items.filter(isCaptureNavigationItem);
};

export const CanvasCaptureNavigation: React.FC<CaptureNavigationControls> = ({
  canGoPrevious,
  canGoNext,
  onGoPrevious,
  onGoNext,
}) => {
  const navigationItems = getCaptureNavigationItems({
    canGoPrevious,
    canGoNext,
    onGoPrevious,
    onGoNext,
  });

  if (navigationItems.length === 0) {
    return null;
  }

  return (
    <div className="canvas-capture-nav" aria-label="Capture navigation">
      {navigationItems.map(({ key, ariaLabel, className, icon, onNavigate }) => (
        <CaptureNavigationButton
          key={key}
          ariaLabel={ariaLabel}
          className={className}
          icon={icon}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  );
};
