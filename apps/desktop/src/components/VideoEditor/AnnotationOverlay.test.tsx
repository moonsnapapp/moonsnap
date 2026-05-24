import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultAnnotationShape } from '@/utils/videoAnnotations';
import { useVideoEditorStore } from '@/stores/videoEditorStore';
import { AnnotationOverlay } from './AnnotationOverlay';

describe('AnnotationOverlay', () => {
  const resetStore = () => {
    useVideoEditorStore.setState(useVideoEditorStore.getInitialState(), true);
  };

  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
    resetStore();
  });

  it('uses only endpoint handles for selected arrows at low opacity', () => {
    const arrowShape = {
      ...createDefaultAnnotationShape('arrow'),
      opacity: 0.3,
    };
    const segmentId = 'annotation-segment-arrow';

    useVideoEditorStore.setState({
      selectedAnnotationSegmentId: segmentId,
      selectedAnnotationShapeId: arrowShape.id,
    });

    const { container } = render(
      <AnnotationOverlay
        segments={[
          {
            id: segmentId,
            startMs: 0,
            endMs: 3000,
            enabled: true,
            shapes: [arrowShape],
          },
        ]}
        currentTimeMs={1000}
        previewWidth={320}
        previewHeight={180}
      />
    );

    expect(container.querySelector('path[stroke-dasharray="6 4"]')).toBeNull();
    expect(container.querySelector('[stroke="var(--accent-400)"]')).toBeNull();
    expect(container.querySelectorAll('circle[fill="var(--accent-400)"]')).toHaveLength(2);
  });

  it('renders arrow shafts as a single filled shape to avoid opacity seams', () => {
    const arrowShape = {
      ...createDefaultAnnotationShape('arrow'),
      opacity: 0.3,
    };

    const { container } = render(
      <AnnotationOverlay
        segments={[
          {
            id: 'annotation-segment-arrow-preview',
            startMs: 0,
            endMs: 3000,
            enabled: true,
            shapes: [arrowShape],
          },
        ]}
        currentTimeMs={1000}
        previewWidth={320}
        previewHeight={180}
      />
    );

    expect(container.querySelector(`path[fill="${arrowShape.strokeColor}"]`)).not.toBeNull();
    expect(container.querySelectorAll(`circle[fill="${arrowShape.strokeColor}"]`)).toHaveLength(0);
  });

  it('renders box geometry with the shared annotation scale contract', () => {
    const rectShape = {
      ...createDefaultAnnotationShape('rectangle'),
      x: 0.1,
      y: 0.2,
      width: 0.4,
      height: 0.3,
      strokeWidth: 12,
    };

    const { container } = render(
      <AnnotationOverlay
        segments={[
          {
            id: 'annotation-segment-rect-preview',
            startMs: 0,
            endMs: 3000,
            enabled: true,
            shapes: [rectShape],
          },
        ]}
        currentTimeMs={1000}
        previewWidth={800}
        previewHeight={450}
      />
    );

    const rect = container.querySelector(`rect[fill="${rectShape.fillColor}"]`);

    expect(rect).not.toBeNull();
    expect(rect?.getAttribute('x')).toBe('80');
    expect(rect?.getAttribute('y')).toBe('90');
    expect(rect?.getAttribute('width')).toBe('320');
    expect(rect?.getAttribute('height')).toBe('135');
    expect(rect?.getAttribute('rx')).toBe('10.8');
    expect(rect?.getAttribute('stroke-width')).toBe('5');
  });

  it('does not render legacy annotation text shapes', () => {
    const textShape = createDefaultAnnotationShape('text', {
      text: 'Text',
    });

    const { container } = render(
      <AnnotationOverlay
        segments={[
          {
            id: 'annotation-segment-text-preview',
            startMs: 0,
            endMs: 3000,
            enabled: true,
            shapes: [textShape],
          },
        ]}
        currentTimeMs={1000}
        previewWidth={800}
        previewHeight={450}
      />
    );

    expect(container.querySelector('text')).toBeNull();
    expect(container.textContent).not.toContain('Text');
  });
});
