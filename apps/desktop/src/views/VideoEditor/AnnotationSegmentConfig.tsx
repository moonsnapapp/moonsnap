import { useMemo, useState, type CSSProperties, type HTMLAttributes } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowUpRight,
  Circle,
  Diamond,
  FileText,
  ListOrdered,
  Plus,
  Square,
  Trash2,
} from 'lucide-react';
import { ColorPicker } from '@/components/ui/color-picker';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  onReorderShape: (shapeId: string, targetIndex: number) => void;
  onDeleteShape: (shapeId: string) => void;
  onDeleteSegment: () => void;
  onDone: () => void;
}

const ADDABLE_SHAPE_TYPES: AnnotationShapeType[] = ['rectangle', 'ellipse', 'arrow', 'step'];
const LEGACY_TEXT_SHAPE_TYPE: AnnotationShapeType = 'text';

const getShapeIcon = (shapeType: AnnotationShapeType) => {
  switch (shapeType) {
    case 'rectangle':
      return Square;
    case 'ellipse':
      return Circle;
    case 'arrow':
    case 'line':
      return ArrowUpRight;
    case 'step':
      return ListOrdered;
    case 'text':
      return FileText;
    default:
      return Diamond;
  }
};

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

const layerCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCenter(args);
};

interface LayerRowData {
  shape: AnnotationShape;
  index: number;
}

type LayerDropIndicatorPosition = 'before' | 'after';

interface LayerCardProps {
  shape: AnnotationShape;
  index: number;
  isSelected: boolean;
  isDragging?: boolean;
  isOverlay?: boolean;
  dropIndicator?: LayerDropIndicatorPosition | null;
  dragAttributes?: HTMLAttributes<HTMLElement>;
  dragListeners?: HTMLAttributes<HTMLElement>;
  setNodeRef?: (node: HTMLDivElement | null) => void;
  style?: CSSProperties;
  onSelectShape?: (id: string) => void;
  onDeleteShape?: (shapeId: string) => void;
}

function LayerCard({
  shape,
  index,
  isSelected,
  isDragging = false,
  isOverlay = false,
  dropIndicator = null,
  dragAttributes,
  dragListeners,
  setNodeRef,
  style,
  onSelectShape,
  onDeleteShape,
}: LayerCardProps) {
  const LayerIcon = getShapeIcon(shape.shapeType);
  const shapeLabel = getAnnotationShapeLabel(shape.shapeType);
  const layerLabel = `Layer ${index + 1} - ${shapeLabel}`;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative flex min-h-10 w-full min-w-0 cursor-grab touch-none items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-[background-color,border-color,box-shadow,opacity] active:cursor-grabbing ${
        isSelected
          ? 'border-[var(--accent-300)] bg-[var(--accent-50)] text-[var(--ink-dark)]'
          : 'border-[var(--glass-border)] bg-[var(--polar-mist)] text-[var(--ink-dark)] hover:bg-[var(--glass-highlight)]'
      } ${isOverlay ? 'border-[var(--accent-300)] bg-[var(--accent-50)] opacity-100' : ''} ${
        isDragging ? 'scale-[0.985] opacity-40' : ''
      }`}
      {...dragAttributes}
      {...dragListeners}
    >
      {dropIndicator && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute left-1 right-1 z-20 h-0.5 rounded-full bg-[var(--accent-400)] ${
            dropIndicator === 'before' ? '-top-1' : '-bottom-1'
          }`}
          style={{
            filter: 'drop-shadow(0 0 4px rgba(249, 115, 22, 0.55))',
          }}
        >
          <span className="absolute left-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[var(--accent-400)]" />
          <span className="absolute right-0 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-[var(--accent-400)]" />
        </span>
      )}
      <button
        type="button"
        onClick={() => onSelectShape?.(shape.id)}
        aria-current={isSelected ? 'true' : undefined}
        aria-label={`Select ${shapeLabel} annotation layer ${index + 1}`}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center ${
            isSelected
              ? 'text-[var(--accent-400)]'
              : 'text-[var(--ink-muted)]'
          }`}
          aria-hidden="true"
        >
          <LayerIcon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {layerLabel}
        </span>
      </button>
      {onDeleteShape && (
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDeleteShape(shape.id)}
            aria-label={`Delete ${shapeLabel} layer`}
            title="Delete layer"
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--ink-muted)] transition-colors hover:bg-[var(--error-light)] hover:text-[var(--error)]"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </span>
      )}
    </div>
  );
}

function SortableLayerCard(props: Omit<LayerCardProps, 'dragAttributes' | 'dragListeners' | 'setNodeRef' | 'style' | 'isDragging'>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    isDragging,
  } = useSortable({ id: props.shape.id });

  return (
    <LayerCard
      {...props}
      isDragging={isDragging}
      dragAttributes={attributes}
      dragListeners={listeners}
      setNodeRef={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
      }}
    />
  );
}

interface SelectedShapeControlsProps {
  selectedShape: AnnotationShape;
  shapeTypeOptions: AnnotationShapeType[];
  onUpdateShape: (shapeId: string, updates: Partial<AnnotationShape>) => void;
}

function ShapeGuidance({ shapeType }: { shapeType: AnnotationShapeType }) {
  if (shapeType === LEGACY_TEXT_SHAPE_TYPE) {
    return (
      <p className="text-xs text-[var(--ink-subtle)]">
        Text annotations are legacy. Use the Text track for new text overlays.
      </p>
    );
  }

  if (isEndpointAnnotationShapeType(shapeType)) {
    return (
      <p className="text-xs text-[var(--ink-subtle)]">
        Drag the start and end dots in the preview to position this shape.
      </p>
    );
  }

  return (
    <p className="text-xs text-[var(--ink-subtle)]">
      Drag the shape in the preview to move it, and use the resize handles to adjust its bounds.
    </p>
  );
}

interface ShapeSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onValueChange: (value: number) => void;
}

function ShapeSlider({
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onValueChange,
}: ShapeSliderProps) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">{label}</span>
        <span className="font-mono text-xs text-[var(--ink-dark)]">{valueLabel}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(values) => onValueChange(values[0])}
      />
    </div>
  );
}

function StrokeControls({
  selectedShape,
  onUpdateShape,
}: Pick<SelectedShapeControlsProps, 'selectedShape' | 'onUpdateShape'>) {
  return (
    <>
      <ShapeSlider
        label="Stroke Width"
        value={selectedShape.strokeWidth}
        min={1}
        max={24}
        step={1}
        valueLabel={`${selectedShape.strokeWidth.toFixed(0)}px`}
        onValueChange={(strokeWidth) => onUpdateShape(selectedShape.id, { strokeWidth })}
      />

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
  );
}

function LegacyTextControls({
  selectedShape,
  onUpdateShape,
}: Pick<SelectedShapeControlsProps, 'selectedShape' | 'onUpdateShape'>) {
  return (
    <>
      <div>
        <span className="mb-2 block text-xs text-[var(--ink-muted)]">Text</span>
        <textarea
          value={selectedShape.text}
          onChange={(event) => onUpdateShape(selectedShape.id, { text: event.target.value })}
          className="h-20 w-full resize-none rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 py-1.5 text-sm text-[var(--ink-dark)]"
        />
      </div>

      <ShapeSlider
        label="Font Size"
        value={selectedShape.fontSize}
        min={12}
        max={160}
        step={2}
        valueLabel={`${selectedShape.fontSize.toFixed(0)}px`}
        onValueChange={(fontSize) => onUpdateShape(selectedShape.id, { fontSize })}
      />
    </>
  );
}

function SelectedShapeControls({
  selectedShape,
  shapeTypeOptions,
  onUpdateShape,
}: SelectedShapeControlsProps) {
  const isStepShape = selectedShape.shapeType === 'step';
  const isLegacyTextShape = selectedShape.shapeType === LEGACY_TEXT_SHAPE_TYPE;
  const showStrokeControls = !isStepShape;
  const showFillControls =
    !isEndpointAnnotationShapeType(selectedShape.shapeType) &&
    !isLegacyTextShape &&
    !isStepShape;

  return (
    <>
      <div>
        <span className="mb-2 block text-xs text-[var(--ink-muted)]">Shape Type</span>
        <Select
          value={selectedShape.shapeType}
          onValueChange={(value) =>
            onUpdateShape(selectedShape.id, { shapeType: value as AnnotationShapeType })
          }
        >
          <SelectTrigger className="h-8 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
            {shapeTypeOptions.map((shapeType) => (
              <SelectItem
                key={shapeType}
                value={shapeType}
                className="text-sm"
              >
                {getAnnotationShapeLabel(shapeType)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <ShapeGuidance shapeType={selectedShape.shapeType} />

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

      <ShapeSlider
        label="Opacity"
        value={selectedShape.opacity}
        min={0.1}
        max={1}
        step={0.05}
        valueLabel={selectedShape.opacity.toFixed(2)}
        onValueChange={(opacity) => onUpdateShape(selectedShape.id, { opacity })}
      />

      {showStrokeControls && (
        <StrokeControls
          selectedShape={selectedShape}
          onUpdateShape={onUpdateShape}
        />
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

      {isLegacyTextShape && (
        <LegacyTextControls
          selectedShape={selectedShape}
          onUpdateShape={onUpdateShape}
        />
      )}
    </>
  );
}

export function AnnotationSegmentConfig({
  segment,
  selectedShapeId,
  onSelectShape,
  onAddShape,
  onUpdateShape,
  onReorderShape,
  onDeleteShape,
  onDeleteSegment,
  onDone,
}: AnnotationSegmentConfigProps) {
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [activeLayerWidth, setActiveLayerWidth] = useState<number | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    overId: string;
    position: LayerDropIndicatorPosition;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
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
  const visibleLayerCount = segment.shapes.length;
  const layerCountLabel = visibleLayerCount === 1 ? '1 layer' : `${visibleLayerCount} layers`;
  const layerRows = useMemo(
    (): LayerRowData[] =>
      segment.shapes
        .map((shape, index) => ({
          shape,
          index,
        }))
        .reverse(),
    [segment.shapes]
  );
  const layerIds = useMemo(() => layerRows.map((row) => row.shape.id), [layerRows]);
  const activeLayer = activeLayerId
    ? layerRows.find((row) => row.shape.id === activeLayerId) ?? null
    : null;
  const handleLayerDragStart = (event: DragStartEvent) => {
    setActiveLayerId(String(event.active.id));
    setActiveLayerWidth(event.active.rect.current.initial?.width ?? null);
    setDropIndicator(null);
  };

  const handleLayerDragOver = (event: DragOverEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over?.id != null ? String(event.over.id) : null;

    if (!overId || activeId === overId) {
      setDropIndicator(null);
      return;
    }

    const activeDisplayIndex = layerIds.indexOf(activeId);
    const overDisplayIndex = layerIds.indexOf(overId);
    if (activeDisplayIndex < 0 || overDisplayIndex < 0) {
      setDropIndicator(null);
      return;
    }

    setDropIndicator({
      overId,
      position: activeDisplayIndex < overDisplayIndex ? 'after' : 'before',
    });
  };

  const handleLayerDragEnd = (event: DragEndEvent) => {
    const activeId = String(event.active.id);
    const overId = event.over?.id != null ? String(event.over.id) : null;
    setActiveLayerId(null);
    setActiveLayerWidth(null);
    setDropIndicator(null);

    if (!overId || activeId === overId) {
      return;
    }

    const nextDisplayIndex = layerIds.indexOf(overId);
    if (nextDisplayIndex < 0) {
      return;
    }

    onReorderShape(activeId, segment.shapes.length - 1 - nextDisplayIndex);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={onDone}
            className="h-7 shrink-0 rounded-md bg-[var(--accent-100)] px-2.5 text-xs font-medium text-[var(--accent-400)] transition-colors hover:bg-[var(--accent-200)]"
          >
            Done
          </button>
          <button
            onClick={onDeleteSegment}
            className="h-7 shrink-0 whitespace-nowrap rounded-md bg-[var(--error-light)] px-2.5 text-xs text-[var(--error)] transition-colors hover:bg-[rgba(239,68,68,0.2)]"
          >
            Delete Segment
          </button>
        </div>
        <span className="block text-xs text-[var(--ink-subtle)]">Annotation segment</span>
      </div>

      <div className="space-y-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-[var(--ink-muted)]">Layers</span>
          <span className="text-xs text-[var(--ink-subtle)]">{layerCountLabel}</span>
        </div>
        {segment.shapes.length > 0 ? (
          <DndContext
            sensors={sensors}
            collisionDetection={layerCollisionDetection}
            onDragStart={handleLayerDragStart}
            onDragCancel={() => {
              setActiveLayerId(null);
              setActiveLayerWidth(null);
              setDropIndicator(null);
            }}
            onDragOver={handleLayerDragOver}
            onDragEnd={handleLayerDragEnd}
          >
            <SortableContext items={layerIds} strategy={verticalListSortingStrategy}>
              <div className="annotation-layer-list space-y-1.5 py-1">
                {layerRows.map(({ shape, index }) => (
                  <SortableLayerCard
                    key={shape.id}
                    shape={shape}
                    index={index}
                    isSelected={shape.id === selectedShape?.id}
                    dropIndicator={dropIndicator?.overId === shape.id ? dropIndicator.position : null}
                    onSelectShape={onSelectShape}
                    onDeleteShape={onDeleteShape}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay adjustScale={false} dropAnimation={null} zIndex={1000}>
              {activeLayer ? (
                <LayerCard
                  shape={activeLayer.shape}
                  index={activeLayer.index}
                  isSelected
                  isOverlay
                  style={{
                    width: activeLayerWidth ?? undefined,
                    transform: 'scale(1.03)',
                    filter: 'drop-shadow(0 12px 24px rgba(0, 0, 0, 0.28))',
                  }}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : (
          <div className="rounded-md border border-dashed border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 py-4 text-center text-xs text-[var(--ink-subtle)]">
            No annotation layers yet.
          </div>
        )}
      </div>

      <div>
        <span className="mb-2 block text-xs font-medium text-[var(--ink-muted)]">Add annotation</span>
        <div className="grid grid-cols-2 gap-2">
          {ADDABLE_SHAPE_TYPES.map((shapeType) => {
            const AddIcon = getShapeIcon(shapeType);
            const shapeLabel = getAnnotationShapeLabel(shapeType);

            return (
              <button
                key={shapeType}
                type="button"
                onClick={() => onAddShape(shapeType)}
                aria-label={`Add ${shapeLabel} annotation`}
                className="flex h-8 min-w-0 items-center justify-center gap-1.5 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-xs text-[var(--ink-dark)] transition-colors hover:bg-[var(--glass-highlight)]"
              >
                <Plus className="h-3 w-3 shrink-0 text-[var(--ink-subtle)]" />
                <AddIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{shapeLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedShape && (
        <SelectedShapeControls
          selectedShape={selectedShape}
          shapeTypeOptions={shapeTypeOptions}
          onUpdateShape={onUpdateShape}
        />
      )}

      {!selectedShape && (
        <div className="rounded-md border border-dashed border-[var(--glass-border)] px-3 py-4 text-center text-xs text-[var(--ink-subtle)]">
          Add a shape to start annotating this segment.
        </div>
      )}
    </div>
  );
}
