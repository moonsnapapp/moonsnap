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
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
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
    expect(moveHandle!.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onDelete).not.toHaveBeenCalled();
  });

  it('cancels a text drag without committing and removes listeners idempotently', () => {
    const onSelect = vi.fn();
    const onUpdate = vi.fn();
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
        onDelete={vi.fn()}
        onDragStart={onDragStart}
      />
    );

    const segmentElement = container.querySelector('[data-segment]') as HTMLElement;
    const moveHandle = segmentElement.children[1] as HTMLElement;

    fireEvent.pointerDown(moveHandle, { pointerId: 2, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 200 });
    expect(segmentElement.style.left).toBe('200px');

    fireEvent.pointerCancel(document, { pointerId: 2 });
    expect(segmentElement.style.left).toBe('100px');
    expect(segmentElement.style.width).toBe('200px');
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenNthCalledWith(1, true, 'move');
    expect(onDragStart).toHaveBeenLastCalledWith(false);
    expect(onDragStart).toHaveBeenCalledTimes(2);

    fireEvent(moveHandle, new Event('lostpointercapture'));
    fireEvent.pointerMove(document, { pointerId: 2, clientX: 300 });
    fireEvent.pointerUp(document, { pointerId: 2 });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenCalledTimes(2);
  });

  it('cancels document drag listeners when the segment unmounts', () => {
    const onUpdate = vi.fn();
    const onDragStart = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);

    const { container, unmount } = render(
      <TextSegmentItem
        segment={textSegment}
        segmentId="text_1.000_0"
        isSelected={false}
        timelineZoom={0.1}
        durationSec={10}
        onSelect={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onDragStart={onDragStart}
      />
    );

    const segmentElement = container.querySelector('[data-segment]') as HTMLElement;
    const moveHandle = segmentElement.children[1] as HTMLElement;
    fireEvent.pointerDown(moveHandle, { pointerId: 3, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 3, clientX: 200 });

    unmount();
    expect(onDragStart).toHaveBeenLastCalledWith(false);
    expect(onUpdate).not.toHaveBeenCalled();
    expect(moveHandle.releasePointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerMove(document, { pointerId: 3, clientX: 300 });
    fireEvent.pointerUp(document, { pointerId: 3 });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenCalledTimes(2);
  });

  it('cancels safely when pointer capture is already lost', () => {
    const onUpdate = vi.fn();
    const onDragStart = vi.fn();
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);

    const { container } = render(
      <TextSegmentItem
        segment={textSegment}
        segmentId="text_1.000_0"
        isSelected={false}
        timelineZoom={0.1}
        durationSec={10}
        onSelect={vi.fn()}
        onUpdate={onUpdate}
        onDelete={vi.fn()}
        onDragStart={onDragStart}
      />
    );

    const segmentElement = container.querySelector('[data-segment]') as HTMLElement;
    const moveHandle = segmentElement.children[1] as HTMLElement;
    fireEvent.pointerDown(moveHandle, { pointerId: 4, clientX: 100 });
    fireEvent.pointerMove(document, { pointerId: 4, clientX: 200 });

    fireEvent(moveHandle, new Event('lostpointercapture'));
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenLastCalledWith(false);
    expect(moveHandle.releasePointerCapture).not.toHaveBeenCalled();

    fireEvent.pointerUp(document, { pointerId: 4 });
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onDragStart).toHaveBeenCalledTimes(2);
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
