import { describe, it, expect } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './tooltip';

// Animation classes that cause duplicate/flash visual bugs when combined
const CONFLICTING_ANIMATION_CLASSES = [
  'animate-in',
  'fade-in',
  'zoom-in',
  'slide-in-from-top',
  'slide-in-from-bottom',
  'slide-in-from-left',
  'slide-in-from-right',
];

describe('Tooltip', () => {
  describe('TooltipContent', () => {
    // Regression test: Multiple stacking animations cause a duplicate/flash effect
    // where the tooltip appears to render twice or flicker on open
    it('should not have conflicting animation classes that cause duplicate visuals', () => {
      render(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent data-testid="tooltip-content">
              Content
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const classList = screen.getByTestId('tooltip-content').className;

      // Check that none of the problematic animation classes are present
      for (const animClass of CONFLICTING_ANIMATION_CLASSES) {
        expect(
          classList.includes(animClass),
          `TooltipContent should not have "${animClass}" class - causes duplicate/flash visual bug`
        ).toBe(false);
      }
    });

    it('should forward a custom className', () => {
      render(
        <TooltipProvider>
          <Tooltip open>
            <TooltipTrigger>Trigger</TooltipTrigger>
            <TooltipContent data-testid="tooltip-content" className="custom-class">
              Content
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const classList = screen.getByTestId('tooltip-content').className;

      expect(classList).toContain('custom-class');
    });

    it('should blur mouse-triggered buttons so tooltips do not stay open from focus', () => {
      render(
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button">Trigger</button>
            </TooltipTrigger>
            <TooltipContent>Content</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );

      const trigger = screen.getByRole('button', { name: 'Trigger' });
      act(() => {
        trigger.focus();
      });
      expect(document.activeElement).toBe(trigger);

      act(() => {
        fireEvent.pointerDown(trigger, { pointerType: 'mouse' });
        fireEvent.click(trigger);
      });

      expect(document.activeElement).not.toBe(trigger);
    });
  });
});
