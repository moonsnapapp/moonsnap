import { useMemo } from 'react';
import { Plus } from 'lucide-react';
import { ColorPicker } from '@/components/ui/color-picker';
import { Slider } from '@/components/ui/slider';
import type { AnnotationSegment, AnnotationShape, AnnotationShapeType } from '@/types';
import {
  getAnnotationShapeLabel,
  isEndpointAnnotationShapeType,
  isLegacyAnnotationShapeType,
} from '@/utils/videoAnnotations';

export interface AnnotationSegmentConfigProps {
  segment: AnnotationSegment;
  selectedShapeId: string | null;
  onSelectShape: (id: string) => void;
  onAddShape: (shapeType: AnnotationShapeType) => void;
  onUpdateShape: (shapeId: string, updates: Partial<AnnotationShape>) => void;
  onDeleteShape: (shapeId: string) => void;
  onDeleteSegment: () => void;
  onDone: () => void;
}

const ADDABLE_SHAPE_TYPES: AnnotationShapeType[] = ['rectangle', 'ellipse', 'arrow', 'step'];
const LEGACY_TEXT_SHAPE_TYPE: AnnotationShapeType = 'text';
const COLOR_PRESETS = [
  '#EF4444',
  '#F97316',
  '#22C55E',
  '#3B82F6',
  '#8B5CF6',
  '#EC4899',
  '#FFFFFF',
  '#1A1A1A',
];

export function AnnotationSegmentConfig({
  segment,
  selectedShapeId,
  onSelectShape,
  onAddShape,
  onUpdateShape,
  onDeleteShape,
  onDeleteSegment,
  onDone,
}: AnnotationSegmentConfigProps) {
  const selectedShape = useMemo(() => {
    if (selectedShapeId == null) {
      return null;
    }

    return segment.shapes.find((shape: AnnotationShape) => shape.id === selectedShapeId) ?? null;
  }, [segment.shapes, selectedShapeId]);
  const shapeTypeOptions = useMemo(() => {
    if (selectedShape && isLegacyAnnotationShapeType(selectedShape.shapeType)) {
      return [...ADDABLE_SHAPE_TYPES, selectedShape.shapeType];
    }

    return ADDABLE_SHAPE_TYPES;
  }, [selectedShape]);
  const isStepShape = selectedShape?.shapeType === 'step';
  const isLegacyTextShape = selectedShape?.shapeType === LEGACY_TEXT_SHAPE_TYPE;
  const showStrokeControls = selectedShape != null && !isStepShape;
  const showFillControls =
    selectedShape != null &&
    !isEndpointAnnotationShapeType(selectedShape.shapeType) &&
    !isLegacyTextShape &&
    !isStepShape;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onDone}
            className="h-7 rounded-md bg-[var(--coral-100)] px-2.5 text-xs font-medium text-[var(--coral-400)] transition-colors hover:bg-[var(--coral-200)]"
          >
            Done
          </button>
          <span className="text-xs text-[var(--ink-subtle)]">Annotation segment</span>
        </div>
        <button
          onClick={onDeleteSegment}
          className="h-7 rounded-md bg-[var(--error-light)] px-2.5 text-xs text-[var(--error)] transition-colors hover:bg-[rgba(239,68,68,0.2)]"
        >
          Delete Segment
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">Shapes</span>
          <span className="text-xs text-[var(--ink-subtle)]">{segment.shapes.length} total</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {segment.shapes.map((shape: AnnotationShape, index: number) => (
            <button
              key={shape.id}
              onClick={() => onSelectShape(shape.id)}
              className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
                shape.id === selectedShape?.id
                  ? 'border-[var(--coral-400)] bg-[var(--coral-50)] text-[var(--coral-500)]'
                  : 'border-[var(--glass-border)] bg-[var(--polar-mist)] text-[var(--ink-dark)]'
              }`}
            >
              {index + 1}. {getAnnotationShapeLabel(shape.shapeType)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <span className="mb-2 block text-xs text-[var(--ink-muted)]">Add Shape</span>
        <div className="grid grid-cols-2 gap-2">
          {ADDABLE_SHAPE_TYPES.map((shapeType) => (
            <button
              key={shapeType}
              onClick={() => onAddShape(shapeType)}
              className="flex h-8 items-center justify-center gap-1 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] text-xs text-[var(--ink-dark)] transition-colors hover:bg-[var(--glass-highlight)]"
            >
              <Plus className="h-3 w-3" />
              {getAnnotationShapeLabel(shapeType)}
            </button>
          ))}
        </div>
      </div>

      {selectedShape && (
        <>
          <div>
            <span className="mb-2 block text-xs text-[var(--ink-muted)]">Shape Type</span>
            <select
              value={selectedShape.shapeType}
              onChange={(event) => onUpdateShape(selectedShape.id, { shapeType: event.target.value as AnnotationShapeType })}
              className="h-8 w-full rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]"
            >
              {shapeTypeOptions.map((shapeType) => (
                <option key={shapeType} value={shapeType}>
                  {getAnnotationShapeLabel(shapeType)}
                </option>
              ))}
            </select>
          </div>

          {selectedShape.shapeType === LEGACY_TEXT_SHAPE_TYPE && (
            <p className="text-xs text-[var(--ink-subtle)]">
              Text annotations are legacy. Use the Text track for new text overlays.
            </p>
          )}

          {isEndpointAnnotationShapeType(selectedShape.shapeType) && (
            <p className="text-xs text-[var(--ink-subtle)]">
              Drag the start and end dots in the preview to position this shape.
            </p>
          )}

          {!isEndpointAnnotationShapeType(selectedShape.shapeType) && (
            <p className="text-xs text-[var(--ink-subtle)]">
              Drag the shape in the preview to move it, and use the resize handles to adjust its bounds.
            </p>
          )}

          {isStepShape && (
            <div>
              <span className="mb-2 block text-xs text-[var(--ink-muted)]">Step Number</span>
              <input
                type="number"
                min={1}
                max={99}
                value={selectedShape.number}
                onChange={(event) => onUpdateShape(selectedShape.id, {
                  number: Math.max(1, Math.round(Number(event.target.value) || 1)),
                })}
                className="h-8 w-full rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]"
              />
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-[var(--ink-muted)]">Opacity</span>
              <span className="font-mono text-xs text-[var(--ink-dark)]">{selectedShape.opacity.toFixed(2)}</span>
            </div>
            <Slider
              value={[selectedShape.opacity]}
              min={0.1}
              max={1}
              step={0.05}
              onValueChange={(values) => onUpdateShape(selectedShape.id, { opacity: values[0] })}
            />
          </div>

          {showStrokeControls && (
            <>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-[var(--ink-muted)]">Stroke Width</span>
                  <span className="font-mono text-xs text-[var(--ink-dark)]">{selectedShape.strokeWidth.toFixed(0)}px</span>
                </div>
                <Slider
                  value={[selectedShape.strokeWidth]}
                  min={1}
                  max={24}
                  step={1}
                  onValueChange={(values) => onUpdateShape(selectedShape.id, { strokeWidth: values[0] })}
                />
              </div>

              <div className="space-y-3">
                <span className="text-xs text-[var(--ink-muted)]">Stroke Color</span>
                <ColorPicker
                  value={selectedShape.strokeColor}
                  onChange={(strokeColor) => onUpdateShape(selectedShape.id, { strokeColor })}
                  presets={COLOR_PRESETS}
                  showTransparent
                />
              </div>
            </>
          )}

          {isStepShape && (
            <div className="space-y-3">
              <span className="text-xs text-[var(--ink-muted)]">Badge Color</span>
              <ColorPicker
                value={selectedShape.fillColor}
                onChange={(fillColor) => onUpdateShape(selectedShape.id, { fillColor })}
                presets={COLOR_PRESETS}
              />
            </div>
          )}

          {showFillControls && (
            <div className="space-y-3">
              <span className="text-xs text-[var(--ink-muted)]">Fill Color</span>
              <ColorPicker
                value={selectedShape.fillColor}
                onChange={(fillColor) => onUpdateShape(selectedShape.id, { fillColor })}
                presets={COLOR_PRESETS}
                showTransparent
              />
            </div>
          )}

          {selectedShape.shapeType === LEGACY_TEXT_SHAPE_TYPE && (
            <>
              <div>
                <span className="mb-2 block text-xs text-[var(--ink-muted)]">Text</span>
                <textarea
                  value={selectedShape.text}
                  onChange={(event) => onUpdateShape(selectedShape.id, { text: event.target.value })}
                  className="h-20 w-full resize-none rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 py-1.5 text-sm text-[var(--ink-dark)]"
                />
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-[var(--ink-muted)]">Font Size</span>
                  <span className="font-mono text-xs text-[var(--ink-dark)]">{selectedShape.fontSize.toFixed(0)}px</span>
                </div>
                <Slider
                  value={[selectedShape.fontSize]}
                  min={12}
                  max={160}
                  step={2}
                  onValueChange={(values) => onUpdateShape(selectedShape.id, { fontSize: values[0] })}
                />
              </div>
            </>
          )}

          <button
            onClick={() => onDeleteShape(selectedShape.id)}
            className="h-8 rounded-md border border-[var(--error-light)] bg-[rgba(239,68,68,0.08)] text-xs text-[var(--error)] transition-colors hover:bg-[rgba(239,68,68,0.14)]"
          >
            Delete Shape
          </button>
        </>
      )}

      {!selectedShape && (
        <div className="rounded-md border border-dashed border-[var(--glass-border)] px-3 py-4 text-center text-xs text-[var(--ink-subtle)]">
          Add a shape to start annotating this segment.
        </div>
      )}
    </div>
  );
}
