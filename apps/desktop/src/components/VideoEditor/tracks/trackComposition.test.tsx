import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SceneSegment, TextSegment } from '@/types';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { SceneTrackContent } from './SceneTrack';
import { TextSegmentItem } from './TextTrackComposition';

const textSegment: TextSegment = {
  start: 1,
  end: 3,
  enabled: true,
  content: 'Caption',
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

describe('timeline track composition', () => {
  beforeEach(() => {
    useVideoEditorStore.setState(useVideoEditorStore.getInitialState(), true);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it('keeps TextSegmentItem seconds-based dragging while using the extracted segment shell', () => {
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
    const onDelete = vi.fn();
    const onDragStart = vi.fn();

    const { container } = render(
      <TextSegmentItem
        segment={textSegment}
        segmentId="text_1.000_0"
        isSelected={false}
        timelineZoom={0.1}
        durationSec={10}
        onSelect={onSelect}
        onUpdate={onUpdate}
        onDelete={onDelete}
        onDragStart={onDragStart}
      />
    );

    const segmentElement = container.querySelector('[data-segment]');
    const moveHandle = segmentElement?.children[1] as HTMLElement | undefined;

    expect(moveHandle).toBeDefined();

    fireEvent.pointerDown(moveHandle!, { pointerId: 1, clientX: 100 });
    fireEvent.pointerMove(moveHandle!, { pointerId: 1, clientX: 200 });
    fireEvent.pointerUp(moveHandle!, { pointerId: 1 });

    expect(onSelect).toHaveBeenCalledWith('text_1.000_0');
    expect(onDragStart).toHaveBeenNthCalledWith(1, true, 'move');
    expect(onDragStart).toHaveBeenLastCalledWith(false);
    expect(onUpdate).toHaveBeenCalledWith('text_1.000_0', {
      start: 2,
      end: 4,
    });
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('renders scene segments through the shared BaseSegmentItem affordances', () => {
    const segment: SceneSegment = {
      id: 'scene-1',
      startMs: 1000,
      endMs: 4000,
      mode: 'cameraOnly',
    };

    useVideoEditorStore.setState({
      selectedSceneSegmentId: segment.id,
    });

    render(
      <SceneTrackContent
        segments={[segment]}
        defaultMode="default"
        durationMs={10000}
        timelineZoom={0.1}
        width={1000}
      />
    );

    expect(screen.getByText('Camera Only')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete selected segment' })).toBeInTheDocument();
  });
});
