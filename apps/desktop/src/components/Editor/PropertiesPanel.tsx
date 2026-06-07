import React from 'react';
import {
  Sparkles,
  MousePointer2,
  Minus,
  Type,
  MoveUpRight,
  Square,
  Circle,
  Highlighter,
  Grid3X3,
  Hash,
  Pencil,
  Crop,
} from 'lucide-react';
import { useEditorStore } from '../../stores/editorStore';
import { useEditorHistory } from '../../hooks/useEditorHistory';
import { type CanvasShape, type Tool } from '../../types';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { ColorPicker } from '@/components/ui/color-picker';
import { BackgroundSettings, BlurToolSettings, TextToolSettings } from './properties';

// Color presets for quick selection
const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#22C55E', '#3B82F6',
  '#8B5CF6', '#EC4899', '#FFFFFF', '#1A1A1A',
];

// Quick style presets per tool type
const STROKE_PRESETS_DATA = [
  { id: 'bug', name: 'Bug', stroke: '#EF4444', strokeWidth: 3 },
  { id: 'tutorial', name: 'Tutorial', stroke: '#3B82F6', strokeWidth: 2 },
  { id: 'warning', name: 'Warning', stroke: '#F97316', strokeWidth: 3 },
  { id: 'subtle', name: 'Subtle', stroke: '#6B7280', strokeWidth: 1 },
];

const HIGHLIGHT_PRESETS_DATA = [
  { id: 'yellow', name: 'Yellow', fill: 'rgba(255, 235, 59, 0.4)' },
  { id: 'green', name: 'Green', fill: 'rgba(76, 175, 80, 0.4)' },
  { id: 'pink', name: 'Pink', fill: 'rgba(233, 30, 99, 0.4)' },
  { id: 'blue', name: 'Blue', fill: 'rgba(33, 150, 243, 0.4)' },
];

type StrokePreset = typeof STROKE_PRESETS_DATA[number];
type HighlightPreset = typeof HIGHLIGHT_PRESETS_DATA[number];
type StrokeQuickStyleTool = Extract<Tool, 'arrow' | 'line' | 'pen'>;
type ShapeQuickStyleTool = Extract<Tool, 'rect' | 'circle'>;
const FALLBACK_COLOR = '#1A1A1A';
const STROKE_TOOLS: Tool[] = ['arrow', 'line', 'rect', 'circle', 'pen'];
const HIGHLIGHT_TOOLS: Tool[] = ['highlight'];
const SHAPE_FILL_TOOLS = new Set<Tool>(['rect', 'circle']);
const HIGHLIGHT_COLOR_PRESETS = ['#FFEB3B', '#FFC107', '#FF9800', '#4CAF50', '#00BCD4', '#E91E63'];
const STROKE_COLOR_SHAPE_TYPES = new Set<CanvasShape['type']>([
  'arrow',
  'line',
  'rect',
  'circle',
  'pen',
  'text',
]);
const FILL_COLOR_SHAPE_TYPES = new Set<CanvasShape['type']>(['rect', 'circle', 'text']);
const FILL_FALLBACK_SHAPE_TYPES = new Set<CanvasShape['type']>(['rect', 'circle']);
const STROKE_WIDTH_SHAPE_TYPES = new Set<CanvasShape['type']>(['arrow', 'line', 'rect', 'circle', 'pen']);
const BLUR_SHAPE_TYPES = new Set<CanvasShape['type']>(['blur']);
const STEP_SHAPE_TYPES = new Set<CanvasShape['type']>(['step']);
const SHAPE_TYPE_TO_TOOL: Partial<Record<CanvasShape['type'], Tool>> = {
  arrow: 'arrow',
  line: 'line',
  rect: 'rect',
  circle: 'circle',
  text: 'text',
  highlight: 'highlight',
  blur: 'blur',
  step: 'steps',
  pen: 'pen',
};

// Tool display info
const TOOL_INFO: Record<Tool, { icon: React.ElementType; label: string }> = {
  select: { icon: MousePointer2, label: 'Select' },
  crop: { icon: Crop, label: 'Crop' },
  arrow: { icon: MoveUpRight, label: 'Arrow' },
  line: { icon: Minus, label: 'Line' },
  rect: { icon: Square, label: 'Rectangle' },
  circle: { icon: Circle, label: 'Ellipse' },
  text: { icon: Type, label: 'Text' },
  highlight: { icon: Highlighter, label: 'Highlight' },
  blur: { icon: Grid3X3, label: 'Blur' },
  steps: { icon: Hash, label: 'Steps' },
  pen: { icon: Pencil, label: 'Pen' },
  background: { icon: Sparkles, label: 'Background' },
};

function QuickStylesSection({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">
        Quick Styles
      </Label>
      <div className="flex gap-1">{children}</div>
    </div>
  );
}

function StrokeQuickStyles({
  tool,
  strokeColor,
  strokeWidth,
  onApplyPreset,
}: {
  tool: StrokeQuickStyleTool;
  strokeColor: string;
  strokeWidth: number;
  onApplyPreset: (preset: StrokePreset) => void;
}) {
  const IconComponent = tool === 'arrow' ? MoveUpRight : tool === 'line' ? Minus : Pencil;

  return (
    <QuickStylesSection>
      {STROKE_PRESETS_DATA.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onApplyPreset(preset)}
          className={`preset-option ${
            strokeColor === preset.stroke && strokeWidth === preset.strokeWidth
              ? 'preset-option--active'
              : ''
          }`}
          title={`${preset.name}: ${preset.strokeWidth}px`}
        >
          <IconComponent
            size={20}
            style={{ color: preset.stroke, strokeWidth: preset.strokeWidth * 0.8 }}
          />
          <span className="preset-option__label">{preset.name}</span>
        </button>
      ))}
    </QuickStylesSection>
  );
}

function ShapeQuickStyles({
  tool,
  strokeColor,
  strokeWidth,
  onApplyPreset,
}: {
  tool: ShapeQuickStyleTool;
  strokeColor: string;
  strokeWidth: number;
  onApplyPreset: (preset: StrokePreset) => void;
}) {
  const IconComponent = tool === 'rect' ? Square : Circle;

  return (
    <QuickStylesSection>
      {STROKE_PRESETS_DATA.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onApplyPreset(preset)}
          className={`preset-option ${
            strokeColor === preset.stroke && strokeWidth === preset.strokeWidth
              ? 'preset-option--active'
              : ''
          }`}
          title={`${preset.name}: ${preset.strokeWidth}px`}
        >
          <IconComponent
            size={20}
            style={{ color: preset.stroke, strokeWidth: preset.strokeWidth * 0.8 }}
          />
          <span className="preset-option__label">{preset.name}</span>
        </button>
      ))}
    </QuickStylesSection>
  );
}

function HighlightQuickStyles({
  selectedFill,
  onApplyPreset,
}: {
  selectedFill: string | undefined;
  onApplyPreset: (preset: HighlightPreset) => void;
}) {
  return (
    <QuickStylesSection>
      {HIGHLIGHT_PRESETS_DATA.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onApplyPreset(preset)}
          className={`preset-option ${selectedFill === preset.fill ? 'preset-option--active' : ''}`}
          title={preset.name}
        >
          <div
            className="w-8 h-4 rounded-sm"
            style={{ backgroundColor: preset.fill }}
          />
          <span className="preset-option__label">{preset.name}</span>
        </button>
      ))}
    </QuickStylesSection>
  );
}

function hexToHighlightFill(color: string): string {
  const r = parseInt(color.slice(1, 3), 16);
  const g = parseInt(color.slice(3, 5), 16);
  const b = parseInt(color.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, 0.4)`;
}

function getStrokeColorUpdate(shape: CanvasShape, color: string): Partial<CanvasShape> | null {
  if (STROKE_COLOR_SHAPE_TYPES.has(shape.type)) {
    return { stroke: color };
  }

  if (shape.type === 'step') {
    return { fill: color };
  }

  if (shape.type === 'highlight') {
    return { fill: hexToHighlightFill(color) };
  }

  return null;
}

function updateMatchingShapes(
  shapes: CanvasShape[],
  shapeTypes: Set<CanvasShape['type']>,
  updateShape: (id: string, updates: Partial<CanvasShape>) => void,
  getUpdate: (shape: CanvasShape) => Partial<CanvasShape> | null,
) {
  shapes.forEach((shape) => {
    if (!shapeTypes.has(shape.type)) return;
    const update = getUpdate(shape);
    if (update) {
      updateShape(shape.id, update);
    }
  });
}

function updateSelectedStrokeColor(
  shapes: CanvasShape[],
  color: string,
  updateShape: (id: string, updates: Partial<CanvasShape>) => void,
) {
  updateMatchingShapes(shapes, STROKE_COLOR_SHAPE_TYPES, updateShape, (shape) =>
    getStrokeColorUpdate(shape, color)
  );
}

function applyTransparentColorFallback({
  shouldApply,
  fallbackSetter,
  hasSelection,
  selectedShapes,
  updateShape,
  fallbackUpdate,
  recordAction,
}: {
  shouldApply: boolean;
  fallbackSetter: (color: string) => void;
  hasSelection: boolean;
  selectedShapes: CanvasShape[];
  updateShape: (id: string, updates: Partial<CanvasShape>) => void;
  fallbackUpdate: Partial<CanvasShape>;
  recordAction: (action: () => void) => void;
}) {
  if (!shouldApply) return;

  fallbackSetter(FALLBACK_COLOR);
  if (!hasSelection) return;

  recordAction(() => {
    updateMatchingShapes(selectedShapes, FILL_FALLBACK_SHAPE_TYPES, updateShape, () => fallbackUpdate);
  });
}

function shouldApplyTransparentColorFallback(nextColor: string, pairedColor: string) {
  return nextColor === 'transparent' && pairedColor === 'transparent';
}

function getToolForShape(shapeType: CanvasShape['type']): Tool {
  return SHAPE_TYPE_TO_TOOL[shapeType] ?? 'select';
}

function StepsQuickStyles({
  strokeColor,
  onApplyPreset,
}: {
  strokeColor: string;
  onApplyPreset: (preset: StrokePreset) => void;
}) {
  return (
    <QuickStylesSection>
      {STROKE_PRESETS_DATA.map((preset) => (
        <button
          key={preset.id}
          onClick={() => onApplyPreset(preset)}
          className={`preset-option ${strokeColor === preset.stroke ? 'preset-option--active' : ''}`}
          title={preset.name}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
            style={{ backgroundColor: preset.stroke }}
          >
            1
          </div>
          <span className="preset-option__label">{preset.name}</span>
        </button>
      ))}
    </QuickStylesSection>
  );
}

function ToolTip({ tool }: { tool: Tool }) {
  if (tool === 'select') {
    return (
      <div className="text-xs text-[var(--ink-muted)] leading-relaxed">
        Click on shapes to select them. Drag to move, use handles to resize.
      </div>
    );
  }

  if (tool === 'crop') {
    return (
      <div className="text-xs text-[var(--ink-muted)] leading-relaxed">
        Drag corners or edges to crop. Drag outside the image to expand the canvas.
      </div>
    );
  }

  return null;
}

function ColorControl({
  label,
  value,
  onChange,
  presets,
  showTransparent = false,
  showInput,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
  presets: string[];
  showTransparent?: boolean;
  showInput?: boolean;
}) {
  return (
    <div className="space-y-3">
      <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">
        {label}
      </Label>
      <ColorPicker
        value={value}
        onChange={onChange}
        presets={presets}
        showTransparent={showTransparent}
        showInput={showInput}
      />
    </div>
  );
}

function StrokeWidthControl({
  value,
  onChange,
  onCommit,
}: {
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  return (
    <>
      <Separator className="bg-[var(--polar-frost)]" />
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium flex items-center gap-1.5">
            <Minus className="w-3.5 h-3.5" />
            Stroke Width
          </Label>
          <span className="text-xs text-[var(--ink-dark)] font-mono">{value}px</span>
        </div>
        <Slider
          value={[value]}
          onValueChange={([nextValue]) => onChange(nextValue)}
          onValueCommit={([nextValue]) => onCommit(nextValue)}
          min={1}
          max={20}
          step={1}
          className="w-full"
        />
      </div>
    </>
  );
}

function StepSizeControls({
  stepShapes,
  onApplyRadius,
}: {
  stepShapes: Array<{ id: string; radius?: number }>;
  onApplyRadius: (radius: number) => void;
}) {
  const { hasSteps, minRadius, maxRadius, avgRadius, allSame } = getStepRadiusStats(stepShapes);

  return (
    <>
      <Separator className="bg-[var(--polar-frost)]" />
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">
          Size
        </Label>
        <div className="flex gap-1">
          {[
            { label: 'Smallest', targetRadius: minRadius },
            { label: 'Average', targetRadius: avgRadius },
            { label: 'Largest', targetRadius: maxRadius },
          ].map(({ label, targetRadius }) => (
            <button
              key={label}
              disabled={!hasSteps || allSame}
              onClick={() => onApplyRadius(targetRadius)}
              className="preset-option preset-option--text"
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function getStepRadiusStats(stepShapes: Array<{ id: string; radius?: number }>) {
  const radii = stepShapes.map((shape) => shape.radius ?? 15);
  const hasSteps = radii.length > 0;

  return {
    hasSteps,
    minRadius: getStepRadiusValue(radii, Math.min),
    maxRadius: getStepRadiusValue(radii, Math.max),
    avgRadius: hasSteps ? getAverageStepRadius(radii) : 15,
    allSame: areAllStepRadiiSame(radii),
  };
}

function getStepRadiusValue(radii: number[], selector: (...values: number[]) => number) {
  return radii.length > 0 ? selector(...radii) : 15;
}

function getAverageStepRadius(radii: number[]) {
  return Math.round(radii.reduce((sum, radius) => sum + radius, 0) / radii.length);
}

function areAllStepRadiiSame(radii: number[]) {
  return radii.length > 0 && radii.every((radius) => radius === radii[0]);
}

function ToolQuickStyles({
  tool,
  strokeColor,
  strokeWidth,
  selectedShape,
  onApplyStrokePreset,
  onApplyShapePreset,
  onApplyHighlightPreset,
  onApplyStepsPreset,
}: {
  tool: Tool;
  strokeColor: string;
  strokeWidth: number;
  selectedShape: CanvasShape | null;
  onApplyStrokePreset: (preset: StrokePreset) => void;
  onApplyShapePreset: (preset: StrokePreset) => void;
  onApplyHighlightPreset: (preset: HighlightPreset) => void;
  onApplyStepsPreset: (preset: StrokePreset) => void;
}) {
  const quickStyleRenderer = QUICK_STYLE_RENDERERS.find((renderer) => renderer.matches(tool));
  const selectedHighlightFill =
    selectedShape?.type === 'highlight' ? selectedShape.fill : undefined;

  return quickStyleRenderer?.render({
    tool,
    strokeColor,
    strokeWidth,
    selectedHighlightFill,
    onApplyStrokePreset,
    onApplyShapePreset,
    onApplyHighlightPreset,
    onApplyStepsPreset,
  }) ?? null;
}

interface QuickStyleRenderInput {
  tool: Tool;
  strokeColor: string;
  strokeWidth: number;
  selectedHighlightFill: string | undefined;
  onApplyStrokePreset: (preset: StrokePreset) => void;
  onApplyShapePreset: (preset: StrokePreset) => void;
  onApplyHighlightPreset: (preset: HighlightPreset) => void;
  onApplyStepsPreset: (preset: StrokePreset) => void;
}

const QUICK_STYLE_RENDERERS: Array<{
  matches: (tool: Tool) => boolean;
  render: (input: QuickStyleRenderInput) => React.ReactNode;
}> = [
  {
    matches: (tool) => tool === 'arrow' || tool === 'line' || tool === 'pen',
    render: ({ tool, strokeColor, strokeWidth, onApplyStrokePreset }) => (
      <StrokeQuickStyles
        tool={tool as StrokeQuickStyleTool}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        onApplyPreset={onApplyStrokePreset}
      />
    ),
  },
  {
    matches: (tool) => tool === 'rect' || tool === 'circle',
    render: ({ tool, strokeColor, strokeWidth, onApplyShapePreset }) => (
      <ShapeQuickStyles
        tool={tool as ShapeQuickStyleTool}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        onApplyPreset={onApplyShapePreset}
      />
    ),
  },
  {
    matches: (tool) => tool === 'highlight',
    render: ({ selectedHighlightFill, onApplyHighlightPreset }) => (
      <HighlightQuickStyles
        selectedFill={selectedHighlightFill}
        onApplyPreset={onApplyHighlightPreset}
      />
    ),
  },
  {
    matches: (tool) => tool === 'steps',
    render: ({ strokeColor, onApplyStepsPreset }) => (
      <StepsQuickStyles
        strokeColor={strokeColor}
        onApplyPreset={onApplyStepsPreset}
      />
    ),
  },
];

interface ToolColorControlsProps {
  tool: Tool;
  strokeColor: string;
  fillColor: string;
  onStrokeColorChange: (color: string) => void;
  onFillColorChange: (color: string) => void;
}

function StrokeToolColorControl({
  tool,
  strokeColor,
  onStrokeColorChange,
}: Pick<ToolColorControlsProps, 'tool' | 'strokeColor' | 'onStrokeColorChange'>) {
  if (!STROKE_TOOLS.includes(tool)) return null;

  return (
    <ColorControl
      label="Stroke Color"
      value={strokeColor}
      onChange={onStrokeColorChange}
      presets={COLOR_PRESETS}
      showTransparent
    />
  );
}

function ShapeFillColorControl({
  tool,
  fillColor,
  onFillColorChange,
}: Pick<ToolColorControlsProps, 'tool' | 'fillColor' | 'onFillColorChange'>) {
  if (!SHAPE_FILL_TOOLS.has(tool)) return null;

  return (
    <>
      <Separator className="bg-[var(--polar-frost)]" />
      <ColorControl
        label="Fill Color"
        value={fillColor}
        onChange={onFillColorChange}
        presets={COLOR_PRESETS}
        showTransparent
      />
    </>
  );
}

function TextColorControl({
  tool,
  fillColor,
  onFillColorChange,
}: Pick<ToolColorControlsProps, 'tool' | 'fillColor' | 'onFillColorChange'>) {
  if (tool !== 'text') return null;

  return (
    <ColorControl
      label="Text Color"
      value={fillColor}
      onChange={onFillColorChange}
      presets={COLOR_PRESETS}
    />
  );
}

function StepsColorControl({
  tool,
  strokeColor,
  onStrokeColorChange,
}: Pick<ToolColorControlsProps, 'tool' | 'strokeColor' | 'onStrokeColorChange'>) {
  if (tool !== 'steps') return null;

  return (
    <ColorControl
      label="Badge Color"
      value={strokeColor}
      onChange={onStrokeColorChange}
      presets={COLOR_PRESETS}
    />
  );
}

function HighlightColorControl({
  tool,
  strokeColor,
  onStrokeColorChange,
}: Pick<ToolColorControlsProps, 'tool' | 'strokeColor' | 'onStrokeColorChange'>) {
  if (!HIGHLIGHT_TOOLS.includes(tool)) return null;

  return (
    <ColorControl
      label="Highlight Color"
      value={strokeColor}
      onChange={onStrokeColorChange}
      presets={HIGHLIGHT_COLOR_PRESETS}
      showInput={false}
    />
  );
}

function ToolColorControls(props: ToolColorControlsProps) {
  return (
    <>
      <StrokeToolColorControl {...props} />
      <ShapeFillColorControl {...props} />
      <TextColorControl {...props} />
      <StepsColorControl {...props} />
      <HighlightColorControl {...props} />
    </>
  );
}

function TextAdvancedSettings({
  tool,
  textShape,
  strokeColor,
  strokeWidth,
  onStrokeColorChange,
  onStrokeWidthChange,
}: {
  tool: Tool;
  textShape: React.ComponentProps<typeof TextToolSettings>['textShape'];
  strokeColor: string;
  strokeWidth: number;
  onStrokeColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
}) {
  if (tool !== 'text') return null;

  return (
    <TextToolSettings
      textShape={textShape}
      strokeColor={strokeColor}
      strokeWidth={strokeWidth}
      onStrokeColorChange={onStrokeColorChange}
      onStrokeWidthChange={onStrokeWidthChange}
    />
  );
}

function StepsAdvancedSettings({
  tool,
  shapes,
  onApplyStepRadius,
}: {
  tool: Tool;
  shapes: CanvasShape[];
  onApplyStepRadius: (radius: number) => void;
}) {
  if (tool !== 'steps') return null;

  return (
    <StepSizeControls
      stepShapes={shapes.filter((shape) => shape.type === 'step')}
      onApplyRadius={onApplyStepRadius}
    />
  );
}

function StrokeAdvancedSettings({
  tool,
  displayedStrokeWidth,
  onStrokeWidthChange,
  onStrokeWidthCommit,
}: {
  tool: Tool;
  displayedStrokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
  onStrokeWidthCommit: (width: number) => void;
}) {
  if (![...STROKE_TOOLS, 'pen'].includes(tool)) return null;

  return (
    <StrokeWidthControl
      value={displayedStrokeWidth}
      onChange={onStrokeWidthChange}
      onCommit={onStrokeWidthCommit}
    />
  );
}

function BlurAdvancedSettings({
  tool,
  blurType,
  blurAmount,
  onBlurTypeChange,
  onBlurAmountChange,
}: {
  tool: Tool;
  blurType: React.ComponentProps<typeof BlurToolSettings>['blurType'];
  blurAmount: number;
  onBlurTypeChange: React.ComponentProps<typeof BlurToolSettings>['onBlurTypeChange'];
  onBlurAmountChange: (value: number) => void;
}) {
  if (tool !== 'blur') return null;

  return (
    <BlurToolSettings
      blurType={blurType}
      blurAmount={blurAmount}
      onBlurTypeChange={onBlurTypeChange}
      onBlurAmountChange={onBlurAmountChange}
    />
  );
}

function BackgroundAdvancedSettings({
  tool,
  compositorSettings,
  onCompositorSettingsChange,
}: {
  tool: Tool;
  compositorSettings: Parameters<typeof BackgroundSettings>[0]['settings'];
  onCompositorSettingsChange: Parameters<typeof BackgroundSettings>[0]['onSettingsChange'];
}) {
  if (tool !== 'background') return null;

  return (
    <BackgroundSettings
      settings={compositorSettings}
      onSettingsChange={onCompositorSettingsChange}
    />
  );
}

function ToolAdvancedSettings({
  tool,
  selectedShape,
  shapes,
  strokeColor,
  strokeWidth,
  displayedStrokeWidth,
  blurType,
  blurAmount,
  compositorSettings,
  onStrokeColorChange,
  onStrokeWidthChange,
  onStrokeWidthCommit,
  onApplyStepRadius,
  onBlurTypeChange,
  onBlurAmountChange,
  onCompositorSettingsChange,
}: {
  tool: Tool;
  selectedShape: CanvasShape | null;
  shapes: CanvasShape[];
  strokeColor: string;
  strokeWidth: number;
  displayedStrokeWidth: number;
  blurType: React.ComponentProps<typeof BlurToolSettings>['blurType'];
  blurAmount: number;
  compositorSettings: Parameters<typeof BackgroundSettings>[0]['settings'];
  onStrokeColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  onStrokeWidthCommit: (width: number) => void;
  onApplyStepRadius: (radius: number) => void;
  onBlurTypeChange: React.ComponentProps<typeof BlurToolSettings>['onBlurTypeChange'];
  onBlurAmountChange: (value: number) => void;
  onCompositorSettingsChange: Parameters<typeof BackgroundSettings>[0]['onSettingsChange'];
}) {
  const textShape = selectedShape?.type === 'text' ? selectedShape : null;

  return (
    <>
      <TextAdvancedSettings
        tool={tool}
        textShape={textShape}
        strokeColor={strokeColor}
        strokeWidth={strokeWidth}
        onStrokeColorChange={onStrokeColorChange}
        onStrokeWidthChange={onStrokeWidthChange}
      />
      <StepsAdvancedSettings
        tool={tool}
        shapes={shapes}
        onApplyStepRadius={onApplyStepRadius}
      />
      <StrokeAdvancedSettings
        tool={tool}
        displayedStrokeWidth={displayedStrokeWidth}
        onStrokeWidthChange={onStrokeWidthChange}
        onStrokeWidthCommit={onStrokeWidthCommit}
      />
      <BlurAdvancedSettings
        tool={tool}
        blurType={blurType}
        blurAmount={blurAmount}
        onBlurTypeChange={onBlurTypeChange}
        onBlurAmountChange={onBlurAmountChange}
      />
      <BackgroundAdvancedSettings
        tool={tool}
        compositorSettings={compositorSettings}
        onCompositorSettingsChange={onCompositorSettingsChange}
      />
    </>
  );
}

function getSingleSelectedShape(selectedShapes: CanvasShape[]): CanvasShape | null {
  return selectedShapes.length === 1 ? selectedShapes[0] : null;
}

function getSelectedStrokeShape(singleSelection: CanvasShape | null): CanvasShape | null {
  if (!singleSelection || !STROKE_WIDTH_SHAPE_TYPES.has(singleSelection.type)) {
    return null;
  }

  return singleSelection;
}

function getEffectivePropertiesTool(
  singleSelection: CanvasShape | null,
  selectedTool: Tool,
): Tool {
  return singleSelection ? getToolForShape(singleSelection.type) : selectedTool;
}

function usePropertiesPanelSelection({
  shapes,
  selectedIds,
  selectedTool,
  strokeWidth,
}: {
  shapes: CanvasShape[];
  selectedIds: string[];
  selectedTool: Tool;
  strokeWidth: number;
}) {
  const selectedShapes = shapes.filter((shape) => selectedIds.includes(shape.id));
  const singleSelection = getSingleSelectedShape(selectedShapes);
  const selectedStrokeShape = getSelectedStrokeShape(singleSelection);
  const effectiveTool = getEffectivePropertiesTool(singleSelection, selectedTool);

  return {
    selectedShapes,
    hasSelection: selectedShapes.length > 0,
    singleSelection,
    displayedStrokeWidth: selectedStrokeShape?.strokeWidth ?? strokeWidth,
    effectiveTool,
  };
}

function usePropertiesPanelActions({
  selectedShapes,
  hasSelection,
  fillColor,
  strokeColor,
  onStrokeColorChange,
  onFillColorChange,
  onStrokeWidthChange,
  recordAction,
  takeSnapshot,
  commitSnapshot,
  updateShape,
  setBlurType,
  setBlurAmount,
}: {
  selectedShapes: CanvasShape[];
  hasSelection: boolean;
  fillColor: string;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  onFillColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
  recordAction: (action: () => void) => void;
  takeSnapshot: () => void;
  commitSnapshot: () => void;
  updateShape: (id: string, updates: Partial<CanvasShape>) => void;
  setBlurType: (type: 'pixelate' | 'gaussian') => void;
  setBlurAmount: (amount: number) => void;
}) {
  const strokeWidthSnapshotTaken = React.useRef(false);

  const handleStrokeColorChange = (color: string) => {
    applyTransparentColorFallback({
      shouldApply: shouldApplyTransparentColorFallback(color, fillColor),
      fallbackSetter: onFillColorChange,
      hasSelection,
      selectedShapes,
      updateShape,
      fallbackUpdate: { fill: FALLBACK_COLOR },
      recordAction,
    });

    onStrokeColorChange(color);

    if (hasSelection) {
      recordAction(() => {
        updateSelectedStrokeColor(selectedShapes, color, updateShape);
      });
    }
  };

  const handleFillColorChange = (color: string) => {
    applyTransparentColorFallback({
      shouldApply: shouldApplyTransparentColorFallback(color, strokeColor),
      fallbackSetter: onStrokeColorChange,
      hasSelection,
      selectedShapes,
      updateShape,
      fallbackUpdate: { stroke: FALLBACK_COLOR },
      recordAction,
    });

    onFillColorChange(color);

    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, FILL_COLOR_SHAPE_TYPES, updateShape, () => ({
          fill: color,
        }));
      });
    }
  };

  const handleStrokeWidthChange = (width: number) => {
    if (hasSelection && !strokeWidthSnapshotTaken.current) {
      takeSnapshot();
      strokeWidthSnapshotTaken.current = true;
    }

    onStrokeWidthChange(width);

    if (hasSelection) {
      updateMatchingShapes(selectedShapes, STROKE_WIDTH_SHAPE_TYPES, updateShape, () => ({
        strokeWidth: width,
      }));
    }
  };

  const handleStrokeWidthCommit = (width: number) => {
    onStrokeWidthChange(width);

    if (hasSelection) {
      updateMatchingShapes(selectedShapes, STROKE_WIDTH_SHAPE_TYPES, updateShape, () => ({
        strokeWidth: width,
      }));
      if (strokeWidthSnapshotTaken.current) {
        commitSnapshot();
      }
    }
    strokeWidthSnapshotTaken.current = false;
  };

  const handleBlurTypeChange = (type: 'pixelate' | 'gaussian') => {
    setBlurType(type);
    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, BLUR_SHAPE_TYPES, updateShape, () => ({
          blurType: type,
        }));
      });
    }
  };

  const handleBlurAmountChange = (amount: number) => {
    setBlurAmount(amount);
    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, BLUR_SHAPE_TYPES, updateShape, () => ({
          blurAmount: amount,
          pixelSize: amount,
        }));
      });
    }
  };

  return {
    handleStrokeColorChange,
    handleFillColorChange,
    handleStrokeWidthChange,
    handleStrokeWidthCommit,
    handleBlurTypeChange,
    handleBlurAmountChange,
  };
}

interface PropertiesPanelProps {
  selectedTool: Tool;
  strokeColor: string;
  onStrokeColorChange: (color: string) => void;
  fillColor: string;
  onFillColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (width: number) => void;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  selectedTool,
  strokeColor,
  onStrokeColorChange,
  fillColor,
  onFillColorChange,
  strokeWidth,
  onStrokeWidthChange,
}) => {
  const {
    shapes,
    selectedIds,
    compositorSettings,
    setCompositorSettings,
    blurType,
    setBlurType,
    blurAmount,
    setBlurAmount,
    updateShape,
  } = useEditorStore();

  const { recordAction, takeSnapshot, commitSnapshot } = useEditorHistory();

  const {
    selectedShapes,
    hasSelection,
    singleSelection,
    displayedStrokeWidth,
    effectiveTool,
  } = usePropertiesPanelSelection({ shapes, selectedIds, selectedTool, strokeWidth });
  const {
    handleStrokeColorChange,
    handleFillColorChange,
    handleStrokeWidthChange,
    handleStrokeWidthCommit,
    handleBlurTypeChange,
    handleBlurAmountChange,
  } = usePropertiesPanelActions({
    selectedShapes,
    hasSelection,
    fillColor,
    strokeColor,
    onStrokeColorChange,
    onFillColorChange,
    onStrokeWidthChange,
    recordAction,
    takeSnapshot,
    commitSnapshot,
    updateShape,
    setBlurType,
    setBlurAmount,
  });

  // Apply a stroke-based preset (arrow, line, pen)
  const applyStrokePreset = (preset: typeof STROKE_PRESETS_DATA[0]) => {
    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, new Set<CanvasShape['type']>(['arrow']), updateShape, () => ({
          stroke: preset.stroke,
          fill: preset.stroke,
          strokeWidth: preset.strokeWidth,
        }));
        updateMatchingShapes(selectedShapes, new Set<CanvasShape['type']>(['line', 'pen']), updateShape, () => ({
          stroke: preset.stroke,
          strokeWidth: preset.strokeWidth,
        }));
      });
    }
    onStrokeColorChange(preset.stroke);
    onFillColorChange(preset.stroke); // For new arrows, set fill to match
    onStrokeWidthChange(preset.strokeWidth);
  };

  // Apply a fill-based preset (rect, circle) - applies both stroke and fill
  const applyShapePreset = (preset: typeof STROKE_PRESETS_DATA[0]) => {
    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, FILL_FALLBACK_SHAPE_TYPES, updateShape, () => ({
          stroke: preset.stroke,
          strokeWidth: preset.strokeWidth,
        }));
      });
    }
    onStrokeColorChange(preset.stroke);
    onStrokeWidthChange(preset.strokeWidth);
  };

  // Apply a highlight preset
  const applyHighlightPreset = (preset: typeof HIGHLIGHT_PRESETS_DATA[0]) => {
    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, new Set<CanvasShape['type']>(['highlight']), updateShape, () => ({
          fill: preset.fill,
        }));
      });
    }
    // Extract color from rgba for stroke color default
    const match = preset.fill.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const hex = `#${parseInt(match[1]).toString(16).padStart(2, '0')}${parseInt(match[2]).toString(16).padStart(2, '0')}${parseInt(match[3]).toString(16).padStart(2, '0')}`;
      onStrokeColorChange(hex);
    }
  };

  // Apply a steps/badge preset
  const applyStepsPreset = (preset: typeof STROKE_PRESETS_DATA[0]) => {
    if (hasSelection) {
      recordAction(() => {
        updateMatchingShapes(selectedShapes, STEP_SHAPE_TYPES, updateShape, () => ({
          fill: preset.stroke,
        }));
      });
    }
    onStrokeColorChange(preset.stroke);
  };

  // Render tool-specific properties
  const renderToolProperties = () => {
    return (
      <div className="space-y-5">
        <ToolTip tool={effectiveTool} />

        <ToolQuickStyles
          tool={effectiveTool}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          selectedShape={singleSelection}
          onApplyStrokePreset={applyStrokePreset}
          onApplyShapePreset={applyShapePreset}
          onApplyHighlightPreset={applyHighlightPreset}
          onApplyStepsPreset={applyStepsPreset}
        />

        <ToolColorControls
          tool={effectiveTool}
          strokeColor={strokeColor}
          fillColor={fillColor}
          onStrokeColorChange={handleStrokeColorChange}
          onFillColorChange={handleFillColorChange}
        />

        <ToolAdvancedSettings
          tool={effectiveTool}
          selectedShape={singleSelection}
          shapes={shapes}
          strokeColor={strokeColor}
          strokeWidth={strokeWidth}
          displayedStrokeWidth={displayedStrokeWidth}
          blurType={blurType}
          blurAmount={blurAmount}
          compositorSettings={compositorSettings}
          onStrokeColorChange={onStrokeColorChange}
          onStrokeWidthChange={handleStrokeWidthChange}
          onStrokeWidthCommit={handleStrokeWidthCommit}
          onApplyStepRadius={(targetRadius) => {
            recordAction(() => {
              shapes.forEach((shape) => {
                if (shape.type === 'step') {
                  updateShape(shape.id, { radius: targetRadius });
                }
              });
            });
          }}
          onBlurTypeChange={handleBlurTypeChange}
          onBlurAmountChange={handleBlurAmountChange}
          onCompositorSettingsChange={setCompositorSettings}
        />
      </div>
    );
  };

  // Get the header info based on effective tool
  const toolInfo = TOOL_INFO[effectiveTool];
  const HeaderIcon = toolInfo.icon;

  return (
    <div className="compositor-sidebar w-92 flex flex-col flex-shrink-0 h-full">
      {/* Header */}
      <div className="properties-panel-header">
        <div className="flex items-center gap-2">
          <HeaderIcon className="w-4 h-4 text-[var(--accent-400)]" />
          <span className="text-sm font-medium text-[var(--ink-black)]">{toolInfo.label}</span>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 overflow-y-auto flex-1 relative z-10">
        {renderToolProperties()}
      </div>
    </div>
  );
};
