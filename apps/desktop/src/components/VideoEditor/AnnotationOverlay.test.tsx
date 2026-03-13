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
    expect(container.querySelector('[stroke="var(--coral-400)"]')).toBeNull();
    expect(container.querySelectorAll('circle[fill="var(--coral-400)"]')).toHaveLength(2);
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
});
