import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TextSegment } from '@/types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { createTextSegmentId } from '@/utils/textSegmentId';
import { TextOverlay } from './TextOverlay';

describe('TextOverlay', () => {
  const resetStore = () => {
    useVideoEditorStore.setState(useVideoEditorStore.getInitialState(), true);
  };

  const baseSegment: TextSegment = {
    start: 0,
    end: 5,
    enabled: true,
    content: 'Zoom-aware text',
    center: { x: 0.5, y: 0.5 },
    size: { x: 0.2, y: 0.1 },
    fontFamily: 'system-ui',
    fontSize: 48,
    fontWeight: 700,
    italic: false,
    color: '#ffffff',
    fadeDuration: 0,
    animation: 'none',
    typewriterCharsPerSecond: 24,
    typewriterSoundEnabled: false,
  };

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
    resetStore();
  });

  function renderSelectedOverlay(updateTextSegment = vi.fn()) {
    const segmentId = createTextSegmentId(baseSegment.start, 0);

    useVideoEditorStore.setState({
      selectedTextSegmentId: segmentId,
      selectTextSegment: vi.fn(),
      updateTextSegment,
    });

    const renderResult = render(
      <TextOverlay
        segments={[baseSegment]}
        currentTimeMs={1000}
        renderWidth={1920}
        renderHeight={1080}
        displayWidth={960}
        displayHeight={540}
        zoomScale={2}
      />
    );

    return { ...renderResult, segmentId, updateTextSegment };
  }

  it('accounts for preview zoom when dragging a selected text segment', () => {
    const { container, segmentId, updateTextSegment } = renderSelectedOverlay();
    const item = container.querySelector('div.absolute.pointer-events-auto[style*="cursor: move"]');

    expect(item).not.toBeNull();

    fireEvent.mouseDown(item!, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 196, clientY: 100 });
    fireEvent.mouseUp(document);

    expect(updateTextSegment).toHaveBeenCalledTimes(1);
    expect(updateTextSegment).toHaveBeenCalledWith(segmentId, expect.any(Object));

    const [, updates] = updateTextSegment.mock.calls[0] as [string, Partial<TextSegment>];
    expect(updates.center?.x).toBeCloseTo(0.55, 5);
    expect(updates.center?.y).toBeCloseTo(0.5, 5);
  });

  it('accounts for preview zoom when resizing a selected text segment', () => {
    const { container, segmentId, updateTextSegment } = renderSelectedOverlay();
    const eastHandle = container.querySelector('div.cursor-e-resize');

    expect(eastHandle).not.toBeNull();

    fireEvent.mouseDown(eastHandle!, { clientX: 100, clientY: 100 });
    fireEvent.mouseMove(document, { clientX: 196, clientY: 100 });
    fireEvent.mouseUp(document);

    expect(updateTextSegment).toHaveBeenCalledTimes(1);
    expect(updateTextSegment).toHaveBeenCalledWith(segmentId, expect.any(Object));

    const [, updates] = updateTextSegment.mock.calls[0] as [string, Partial<TextSegment>];
    expect(updates.size?.x).toBeCloseTo(0.25, 5);
    expect(updates.size?.y).toBeCloseTo(0.1, 5);
    expect(updates.center?.x).toBeCloseTo(0.525, 5);
    expect(updates.center?.y).toBeCloseTo(0.5, 5);
  });
});
