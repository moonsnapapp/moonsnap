import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createDefaultAnnotationShape } from '@/utils/videoAnnotations';
import { AnnotationSegmentConfig } from './AnnotationSegmentConfig';

describe('AnnotationSegmentConfig', () => {
  const noop = vi.fn();

  it('offers step for new annotation shapes and removes line/text from the add palette', () => {
    render(
      <AnnotationSegmentConfig
        segment={{
          id: 'annotation-segment-1',
          startMs: 0,
          endMs: 3000,
          enabled: true,
          shapes: [createDefaultAnnotationShape('rectangle')],
        }}
        selectedShapeId={null}
        onSelectShape={noop}
        onAddShape={noop}
        onUpdateShape={noop}
        onDeleteShape={noop}
        onDeleteSegment={noop}
        onDone={noop}
      />
    );

    expect(screen.getByRole('button', { name: /^Step$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Line$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Text$/i })).not.toBeInTheDocument();
  });

  it('preserves legacy line annotations without showing them as a new-shape action', () => {
    const legacyLineShape = createDefaultAnnotationShape('line');

    render(
      <AnnotationSegmentConfig
        segment={{
          id: 'annotation-segment-line-legacy',
          startMs: 0,
          endMs: 3000,
          enabled: true,
          shapes: [legacyLineShape],
        }}
        selectedShapeId={legacyLineShape.id}
        onSelectShape={noop}
        onAddShape={noop}
        onUpdateShape={noop}
        onDeleteShape={noop}
        onDeleteSegment={noop}
        onDone={noop}
      />
    );

    expect(screen.getByRole('option', { name: 'Line (Legacy)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Line$/i })).not.toBeInTheDocument();
  });

  it('preserves legacy text annotations without showing them as a new-shape action', () => {
    const legacyTextShape = createDefaultAnnotationShape('text');

    render(
      <AnnotationSegmentConfig
        segment={{
          id: 'annotation-segment-legacy',
          startMs: 0,
          endMs: 3000,
          enabled: true,
          shapes: [legacyTextShape],
        }}
        selectedShapeId={legacyTextShape.id}
        onSelectShape={noop}
        onAddShape={noop}
        onUpdateShape={noop}
        onDeleteShape={noop}
        onDeleteSegment={noop}
        onDone={noop}
      />
    );

    expect(screen.getByText('Text annotations are legacy. Use the Text track for new text overlays.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Text (Legacy)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Text$/i })).not.toBeInTheDocument();
  });

  it('uses the shared color picker for stroke and fill on box annotations', () => {
    const rectangleShape = createDefaultAnnotationShape('rectangle');
    const { container } = render(
      <AnnotationSegmentConfig
        segment={{
          id: 'annotation-segment-colors',
          startMs: 0,
          endMs: 3000,
          enabled: true,
          shapes: [rectangleShape],
        }}
        selectedShapeId={rectangleShape.id}
        onSelectShape={noop}
        onAddShape={noop}
        onUpdateShape={noop}
        onDeleteShape={noop}
        onDeleteSegment={noop}
        onDone={noop}
      />
    );

    expect(screen.getByText('Stroke Color')).toBeInTheDocument();
    expect(screen.getByText('Fill Color')).toBeInTheDocument();
    expect(screen.getByText('Drag the shape in the preview to move it, and use the resize handles to adjust its bounds.')).toBeInTheDocument();
    expect(screen.getAllByTitle('No fill')).toHaveLength(2);
    expect(container.querySelector('input[type="color"]')).toBeNull();
    expect(screen.queryByText(/^X$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Y$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Width$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Height$/)).not.toBeInTheDocument();
  });

  it('relies on the preview handles for endpoint shape positioning', () => {
    const arrowShape = createDefaultAnnotationShape('arrow');

    render(
      <AnnotationSegmentConfig
        segment={{
          id: 'annotation-segment-arrow',
          startMs: 0,
          endMs: 3000,
          enabled: true,
          shapes: [arrowShape],
        }}
        selectedShapeId={arrowShape.id}
        onSelectShape={noop}
        onAddShape={noop}
        onUpdateShape={noop}
        onDeleteShape={noop}
        onDeleteSegment={noop}
        onDone={noop}
      />
    );

    expect(screen.getByText('Drag the start and end dots in the preview to position this shape.')).toBeInTheDocument();
    expect(screen.queryByText(/^Start X$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Start Y$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^End X$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^End Y$/)).not.toBeInTheDocument();
  });

  it('uses badge-specific controls for step annotations', () => {
    const stepShape = createDefaultAnnotationShape('step', { number: 4 });
    const { container } = render(
      <AnnotationSegmentConfig
        segment={{
          id: 'annotation-segment-step',
          startMs: 0,
          endMs: 3000,
          enabled: true,
          shapes: [stepShape],
        }}
        selectedShapeId={stepShape.id}
        onSelectShape={noop}
        onAddShape={noop}
        onUpdateShape={noop}
        onDeleteShape={noop}
        onDeleteSegment={noop}
        onDone={noop}
      />
    );

    expect(screen.getByText('Step Number')).toBeInTheDocument();
    expect(screen.getByText('Badge Color')).toBeInTheDocument();
    expect(screen.queryByText('Stroke Width')).not.toBeInTheDocument();
    expect(screen.queryByText('Stroke Color')).not.toBeInTheDocument();
    expect(container.querySelector('input[type="number"]')).not.toBeNull();
  });
});
