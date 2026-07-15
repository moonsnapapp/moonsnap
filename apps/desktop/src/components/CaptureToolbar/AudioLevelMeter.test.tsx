import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AudioLevelMeter } from './AudioLevelMeter';

// Mock the useAudioLevel hook
vi.mock('@/hooks/useAudioLevel', () => ({
  useAudioLevel: vi.fn(() => ({
    level: 0,
    isActive: false,
  })),
}));

describe('AudioLevelMeter', () => {
  describe('rendering', () => {
    it('should render with 0% fill when disabled in external mode', () => {
      const { container } = render(
        <AudioLevelMeter enabled={false} level={0.5} />
      );

      // In external mode (level prop provided), component always renders
      const meter = container.querySelector('.glass-audio-meter');
      expect(meter).toBeInTheDocument();

      // But fill should be 0% when disabled
      const fill = container.querySelector('.glass-audio-meter-fill') as HTMLElement;
      expect(fill.style.width).toBe('0%');
    });

    it.each([null, undefined])(
      'should not render in self-managed mode without a device index (%s)',
      (deviceIndex) => {
        const { container } = render(
          <AudioLevelMeter enabled={true} deviceIndex={deviceIndex} />
        );

        const meter = container.querySelector('.glass-audio-meter');
        expect(meter).not.toBeInTheDocument();
      }
    );
  });

  describe('external level mode', () => {
    it.each([
      { level: 0, expectedWidth: '0%' },
      { level: 0.333, expectedWidth: '33%' },
      { level: 0.75, expectedWidth: '75%' },
      { level: 1, expectedWidth: '100%' },
    ])('maps level $level to a $expectedWidth fill', ({ level, expectedWidth }) => {
      const { container } = render(<AudioLevelMeter enabled={true} level={level} />);

      const fill = container.querySelector('.glass-audio-meter-fill') as HTMLElement;
      expect(fill.style.width).toBe(expectedWidth);
    });
  });

  describe('title attribute', () => {
    it('should show audio level in title when active', () => {
      const { container } = render(
        <AudioLevelMeter enabled={true} level={0.5} />
      );

      const meter = container.querySelector('.glass-audio-meter');
      expect(meter?.getAttribute('title')).toBe('Audio level: 50%');
    });
  });

  describe('className prop', () => {
    it('should append a custom class without replacing the meter class', () => {
      const { container } = render(
        <AudioLevelMeter enabled={true} level={0.5} className="custom-class" />
      );

      const meter = container.querySelector('.glass-audio-meter');
      expect(meter?.className).toContain('custom-class');
      expect(meter?.className).toContain('glass-audio-meter');
    });
  });

  describe('defaults', () => {
    it('should be enabled by default', () => {
      const { container } = render(<AudioLevelMeter level={0.5} />);

      const fill = container.querySelector('.glass-audio-meter-fill') as HTMLElement;
      expect(fill.style.width).toBe('50%');
    });
  });
});
