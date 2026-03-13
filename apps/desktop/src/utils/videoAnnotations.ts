import { ANNOTATIONS } from '@/constants';
import type {
  AnnotationConfig,
  AnnotationSegment,
  AnnotationShape,
  AnnotationShapeType,
  TextSegment,
} from '@/types';

export interface AnnotationArrowEndpoints {
  tailX: number;
  tailY: number;
  headX: number;
  headY: number;
}

export interface AnnotationArrowRenderGeometry {
  tailX: number;
  tailY: number;
  headX: number;
  headY: number;
  shaftEndX: number;
  shaftEndY: number;
  shaftLine: string;
  headPoints: string;
}

interface AnnotationArrowShaftOutline {
  headTopX: number;
  headTopY: number;
  headBottomX: number;
  headBottomY: number;
  tailTopX: number;
  tailTopY: number;
  tailBottomX: number;
  tailBottomY: number;
  tailBackX: number;
  tailBackY: number;
  curveTopControl1X: number;
  curveTopControl1Y: number;
  curveTopControl2X: number;
  curveTopControl2Y: number;
  curveBottomControl1X: number;
  curveBottomControl1Y: number;
  curveBottomControl2X: number;
  curveBottomControl2Y: number;
  path: string;
}

export interface AnnotationBoxSliderBounds {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  widthMin: number;
  widthMax: number;
  heightMin: number;
  heightMax: number;
}

export function isEndpointAnnotationShapeType(shapeType: AnnotationShapeType): boolean {
  return shapeType === 'arrow' || shapeType === 'line';
}

export function isLegacyAnnotationShapeType(shapeType: AnnotationShapeType): boolean {
  return shapeType === 'line' || shapeType === 'text';
}

export function getNextAnnotationStepNumber(segments: AnnotationSegment[]): number {
  const existingNumbers = segments
    .flatMap((segment) => segment.shapes)
    .filter((shape) => shape.shapeType === 'step')
    .map((shape) => Math.max(1, Math.round(shape.number)))
    .sort((a, b) => a - b);

  let nextNumber = 1;
  for (const number of existingNumbers) {
    if (number === nextNumber) {
      nextNumber += 1;
      continue;
    }

    if (number > nextNumber) {
      break;
    }
  }

  return nextNumber;
}

export function getAnnotationBoxSliderBounds(): AnnotationBoxSliderBounds {
  return {
    xMin: ANNOTATIONS.BOX_SLIDER_POSITION_MIN,
    xMax: ANNOTATIONS.BOX_SLIDER_POSITION_MAX,
    yMin: ANNOTATIONS.BOX_SLIDER_POSITION_MIN,
    yMax: ANNOTATIONS.BOX_SLIDER_POSITION_MAX,
    widthMin: ANNOTATIONS.MIN_NORMALIZED_SIZE,
    widthMax: ANNOTATIONS.BOX_SLIDER_SIZE_MAX,
    heightMin: ANNOTATIONS.MIN_NORMALIZED_SIZE,
    heightMax: ANNOTATIONS.BOX_SLIDER_SIZE_MAX,
  };
}

const FALLBACK_ARROW_DX = 1 / Math.sqrt(2);
const FALLBACK_ARROW_DY = -1 / Math.sqrt(2);
const ARROW_HEAD_HALF_ANGLE = Math.PI / 6;
const ARROW_HEAD_BASE_FACTOR = Math.cos(ARROW_HEAD_HALF_ANGLE);
const ARROW_TAIL_CURVE_KAPPA = (4 * (Math.sqrt(2) - 1)) / 3;
const ARROW_HEAD_JOIN_OVERLAP_PX = 1.5;

function clampArrowEndpoints(endpoints: AnnotationArrowEndpoints): AnnotationArrowEndpoints {
  const { tailX, tailY } = endpoints;
  let { headX, headY } = endpoints;

  const dx = headX - tailX;
  const dy = headY - tailY;
  const length = Math.hypot(dx, dy);

  if (length >= ANNOTATIONS.MIN_NORMALIZED_SIZE) {
    return { tailX, tailY, headX, headY };
  }

  // Enforce minimum arrow length without clamping to 0-1 bounds
  const unitX = length > 0 ? dx / length : FALLBACK_ARROW_DX;
  const unitY = length > 0 ? dy / length : FALLBACK_ARROW_DY;
  headX = tailX + unitX * ANNOTATIONS.MIN_NORMALIZED_SIZE;
  headY = tailY + unitY * ANNOTATIONS.MIN_NORMALIZED_SIZE;

  return { tailX, tailY, headX, headY };
}

function randomIdFragment(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function generateAnnotationSegmentId(): string {
  return `annotation_${Date.now()}_${randomIdFragment()}`;
}

export function generateAnnotationShapeId(): string {
  return `annotation_shape_${Date.now()}_${randomIdFragment()}`;
}

export function getAnnotationShapeLabel(shapeType: AnnotationShapeType): string {
  switch (shapeType) {
    case 'rectangle':
      return 'Rectangle';
    case 'ellipse':
      return 'Ellipse';
    case 'arrow':
      return 'Arrow';
    case 'line':
      return 'Line (Legacy)';
    case 'step':
      return 'Step';
    case 'text':
      return 'Text (Legacy)';
  }

  return 'Annotation';
}

export function createDefaultAnnotationShape(
  shapeType: AnnotationShapeType = ANNOTATIONS.DEFAULT_SHAPE_TYPE,
  overrides: Partial<AnnotationShape> = {}
): AnnotationShape {
  const baseShape: AnnotationShape = {
    id: generateAnnotationShapeId(),
    shapeType,
    x: 0.2,
    y: 0.2,
    width: 0.3,
    height: 0.2,
    arrowStartX: null,
    arrowStartY: null,
    arrowEndX: null,
    arrowEndY: null,
    strokeColor: ANNOTATIONS.DEFAULT_STROKE_COLOR,
    fillColor: ANNOTATIONS.DEFAULT_FILL_COLOR,
    strokeWidth: ANNOTATIONS.DEFAULT_STROKE_WIDTH,
    opacity: ANNOTATIONS.DEFAULT_OPACITY,
    number: 1,
    text: ANNOTATIONS.DEFAULT_TEXT,
    fontSize: ANNOTATIONS.DEFAULT_FONT_SIZE,
    fontFamily: ANNOTATIONS.DEFAULT_FONT_FAMILY,
    fontWeight: ANNOTATIONS.DEFAULT_FONT_WEIGHT,
  };

  if (shapeType === 'arrow' || shapeType === 'line') {
    return {
      ...baseShape,
      x: 0.2,
      y: 0.28,
      width: 0.3,
      height: 0.1,
      arrowStartX: 0.2,
      arrowStartY: 0.38,
      arrowEndX: 0.5,
      arrowEndY: 0.28,
      fillColor: 'rgba(0, 0, 0, 0)',
      ...overrides,
    };
  }

  if (shapeType === 'step') {
    return {
      ...baseShape,
      x: 0.2,
      y: 0.2,
      width: ANNOTATIONS.DEFAULT_STEP_SIZE,
      height: ANNOTATIONS.DEFAULT_STEP_SIZE,
      fillColor: ANNOTATIONS.DEFAULT_STROKE_COLOR,
      strokeColor: 'rgba(0, 0, 0, 0)',
      ...overrides,
    };
  }

  if (shapeType === 'text') {
    return {
      ...baseShape,
      x: 0.24,
      y: 0.24,
      width: 0.28,
      height: 0.12,
      fillColor: 'rgba(0, 0, 0, 0)',
      strokeColor: ANNOTATIONS.DEFAULT_TEXT_COLOR,
      ...overrides,
    };
  }

  return {
    ...baseShape,
    ...overrides,
  };
}

export function getAnnotationArrowEndpoints(shape: AnnotationShape): AnnotationArrowEndpoints {
  if (
    shape.arrowStartX != null &&
    shape.arrowStartY != null &&
    shape.arrowEndX != null &&
    shape.arrowEndY != null
  ) {
    return clampArrowEndpoints({
      tailX: shape.arrowStartX,
      tailY: shape.arrowStartY,
      headX: shape.arrowEndX,
      headY: shape.arrowEndY,
    });
  }

  return clampArrowEndpoints({
    tailX: shape.x + shape.width * ANNOTATIONS.ARROW_PADDING_FACTOR,
    tailY: shape.y + shape.height * (1 - ANNOTATIONS.ARROW_PADDING_FACTOR),
    headX: shape.x + shape.width * (1 - ANNOTATIONS.ARROW_PADDING_FACTOR),
    headY: shape.y + shape.height * ANNOTATIONS.ARROW_PADDING_FACTOR,
  });
}

export function getAnnotationArrowShapeUpdate(
  shape: AnnotationShape,
  updates: Partial<AnnotationArrowEndpoints>
): Pick<
  AnnotationShape,
  'x' | 'y' | 'width' | 'height' | 'arrowStartX' | 'arrowStartY' | 'arrowEndX' | 'arrowEndY'
> {
  const endpoints = clampArrowEndpoints({
    ...getAnnotationArrowEndpoints(shape),
    ...updates,
  });

  const minX = Math.min(endpoints.tailX, endpoints.headX);
  const minY = Math.min(endpoints.tailY, endpoints.headY);
  const maxX = Math.max(endpoints.tailX, endpoints.headX);
  const maxY = Math.max(endpoints.tailY, endpoints.headY);

  return {
    x: minX,
    y: minY,
    width: Math.max(ANNOTATIONS.MIN_NORMALIZED_SIZE, maxX - minX),
    height: Math.max(ANNOTATIONS.MIN_NORMALIZED_SIZE, maxY - minY),
    arrowStartX: endpoints.tailX,
    arrowStartY: endpoints.tailY,
    arrowEndX: endpoints.headX,
    arrowEndY: endpoints.headY,
  };
}

export function createDefaultAnnotationSegment(startMs: number, endMs: number): AnnotationSegment {
  return {
    id: generateAnnotationSegmentId(),
    startMs,
    endMs,
    enabled: true,
    shapes: [createDefaultAnnotationShape()],
  };
}

export function createDefaultAnnotationConfig(): AnnotationConfig {
  return {
    segments: [],
  };
}

export function normalizeAnnotationShape(
  shape: Partial<AnnotationShape> | null | undefined
): AnnotationShape {
  const defaults = createDefaultAnnotationShape(shape?.shapeType ?? ANNOTATIONS.DEFAULT_SHAPE_TYPE);
  const mergedShape = {
    ...defaults,
    ...shape,
    id: shape?.id ?? defaults.id,
  };

  if (isEndpointAnnotationShapeType(mergedShape.shapeType)) {
    return clampAnnotationShape({
      ...mergedShape,
      ...getAnnotationArrowShapeUpdate(mergedShape, {}),
    });
  }

  return clampAnnotationShape(mergedShape);
}

export function normalizeAnnotationSegment(
  segment: Partial<AnnotationSegment> | null | undefined
): AnnotationSegment {
  const startMs = Math.max(0, segment?.startMs ?? 0);
  const endMs = Math.max(startMs, segment?.endMs ?? startMs + ANNOTATIONS.DEFAULT_SEGMENT_DURATION_MS);

  return {
    id: segment?.id ?? generateAnnotationSegmentId(),
    startMs,
    endMs,
    enabled: segment?.enabled ?? true,
    shapes: Array.isArray(segment?.shapes)
      ? segment.shapes.map((shape) => normalizeAnnotationShape(shape))
      : [createDefaultAnnotationShape()],
  };
}

export function normalizeAnnotationConfig(
  config: Partial<AnnotationConfig> | null | undefined
): AnnotationConfig {
  if (!config || !Array.isArray(config.segments)) {
    return createDefaultAnnotationConfig();
  }

  return {
    segments: config.segments.map((segment) => normalizeAnnotationSegment(segment)),
  };
}

export function clampAnnotationShape(shape: AnnotationShape): AnnotationShape {
  if (isEndpointAnnotationShapeType(shape.shapeType)) {
    const clampedEndpointShape = {
      ...shape,
      ...getAnnotationArrowShapeUpdate(shape, {}),
    };

    return {
      ...clampedEndpointShape,
      strokeWidth: Math.min(
        ANNOTATIONS.MAX_STROKE_WIDTH,
        Math.max(ANNOTATIONS.MIN_STROKE_WIDTH, shape.strokeWidth)
      ),
      fontSize: Math.min(
        ANNOTATIONS.MAX_FONT_SIZE,
        Math.max(ANNOTATIONS.MIN_FONT_SIZE, shape.fontSize)
      ),
      opacity: Math.min(1, Math.max(0, shape.opacity)),
      number: Math.max(1, Math.round(shape.number)),
    };
  }

  const minSize = ANNOTATIONS.MIN_NORMALIZED_SIZE;
  const isStepShape = shape.shapeType === 'step';
  const size = Math.max(minSize, shape.width, shape.height);
  const width = isStepShape ? size : Math.max(minSize, shape.width);
  const height = isStepShape ? size : Math.max(minSize, shape.height);

  return {
    ...shape,
    width,
    height,
    arrowStartX: null,
    arrowStartY: null,
    arrowEndX: null,
    arrowEndY: null,
    strokeWidth: Math.min(
      ANNOTATIONS.MAX_STROKE_WIDTH,
      Math.max(ANNOTATIONS.MIN_STROKE_WIDTH, shape.strokeWidth)
    ),
    fontSize: Math.min(
      ANNOTATIONS.MAX_FONT_SIZE,
      Math.max(ANNOTATIONS.MIN_FONT_SIZE, shape.fontSize)
    ),
    opacity: Math.min(1, Math.max(0, shape.opacity)),
    number: Math.max(1, Math.round(shape.number)),
  };
}

export function getAnnotationArrowRenderGeometry(
  shape: AnnotationShape,
  renderWidth: number,
  renderHeight: number,
  strokeWidth: number
): AnnotationArrowRenderGeometry {
  const endpoints = getAnnotationArrowEndpoints(shape);
  const tailX = endpoints.tailX * renderWidth;
  const tailY = endpoints.tailY * renderHeight;
  const headX = endpoints.headX * renderWidth;
  const headY = endpoints.headY * renderHeight;
  const dx = headX - tailX;
  const dy = headY - tailY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / length;
  const unitY = dy / length;
  const desiredHeadLength = Math.max(strokeWidth * ANNOTATIONS.ARROW_HEAD_FACTOR, 14);
  const headLength = Math.min(desiredHeadLength, length * 0.55);
  const headBaseInset = headLength * ARROW_HEAD_BASE_FACTOR;
  const shaftInset = Math.max(
    0,
    Math.min(length * 0.8, headBaseInset - Math.min(ARROW_HEAD_JOIN_OVERLAP_PX, headBaseInset * 0.2))
  );
  const shaftEndX = headX - unitX * shaftInset;
  const shaftEndY = headY - unitY * shaftInset;
  const headLeftX = headX - headLength * Math.cos(Math.atan2(dy, dx) - ARROW_HEAD_HALF_ANGLE);
  const headLeftY = headY - headLength * Math.sin(Math.atan2(dy, dx) - ARROW_HEAD_HALF_ANGLE);
  const headRightX = headX - headLength * Math.cos(Math.atan2(dy, dx) + ARROW_HEAD_HALF_ANGLE);
  const headRightY = headY - headLength * Math.sin(Math.atan2(dy, dx) + ARROW_HEAD_HALF_ANGLE);

  return {
    tailX,
    tailY,
    headX,
    headY,
    shaftEndX,
    shaftEndY,
    shaftLine: `M ${tailX} ${tailY} L ${shaftEndX} ${shaftEndY}`,
    headPoints: `${headX},${headY} ${headLeftX},${headLeftY} ${headRightX},${headRightY}`,
  };
}

export function getAnnotationArrowShaftOutline(
  geometry: AnnotationArrowRenderGeometry,
  strokeWidth: number
): AnnotationArrowShaftOutline {
  const halfWidth = strokeWidth / 2;
  const dx = geometry.shaftEndX - geometry.tailX;
  const dy = geometry.shaftEndY - geometry.tailY;
  const length = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / length;
  const unitY = dy / length;
  const perpX = -unitY * halfWidth;
  const perpY = unitX * halfWidth;
  const controlDepth = halfWidth * ARROW_TAIL_CURVE_KAPPA;

  const headTopX = geometry.shaftEndX + perpX;
  const headTopY = geometry.shaftEndY + perpY;
  const headBottomX = geometry.shaftEndX - perpX;
  const headBottomY = geometry.shaftEndY - perpY;
  const tailTopX = geometry.tailX + perpX;
  const tailTopY = geometry.tailY + perpY;
  const tailBottomX = geometry.tailX - perpX;
  const tailBottomY = geometry.tailY - perpY;
  const tailBackX = geometry.tailX - unitX * halfWidth;
  const tailBackY = geometry.tailY - unitY * halfWidth;
  const curveTopControl1X = tailTopX - unitX * controlDepth;
  const curveTopControl1Y = tailTopY - unitY * controlDepth;
  const curveTopControl2X = tailBackX + perpX * ARROW_TAIL_CURVE_KAPPA;
  const curveTopControl2Y = tailBackY + perpY * ARROW_TAIL_CURVE_KAPPA;
  const curveBottomControl1X = tailBackX - perpX * ARROW_TAIL_CURVE_KAPPA;
  const curveBottomControl1Y = tailBackY - perpY * ARROW_TAIL_CURVE_KAPPA;
  const curveBottomControl2X = tailBottomX - unitX * controlDepth;
  const curveBottomControl2Y = tailBottomY - unitY * controlDepth;

  return {
    headTopX,
    headTopY,
    headBottomX,
    headBottomY,
    tailTopX,
    tailTopY,
    tailBottomX,
    tailBottomY,
    tailBackX,
    tailBackY,
    curveTopControl1X,
    curveTopControl1Y,
    curveTopControl2X,
    curveTopControl2Y,
    curveBottomControl1X,
    curveBottomControl1Y,
    curveBottomControl2X,
    curveBottomControl2Y,
    path: [
      `M ${headTopX} ${headTopY}`,
      `L ${tailTopX} ${tailTopY}`,
      `C ${curveTopControl1X} ${curveTopControl1Y}, ${curveTopControl2X} ${curveTopControl2Y}, ${tailBackX} ${tailBackY}`,
      `C ${curveBottomControl1X} ${curveBottomControl1Y}, ${curveBottomControl2X} ${curveBottomControl2Y}, ${tailBottomX} ${tailBottomY}`,
      `L ${headBottomX} ${headBottomY}`,
      'Z',
    ].join(' '),
  };
}

function drawArrow(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: AnnotationShape,
  renderWidth: number,
  renderHeight: number,
  strokeWidth: number,
  color: string
) {
  const geometry = getAnnotationArrowRenderGeometry(shape, renderWidth, renderHeight, strokeWidth);
  const shaftOutline = getAnnotationArrowShaftOutline(geometry, strokeWidth);

  ctx.beginPath();
  ctx.moveTo(shaftOutline.headTopX, shaftOutline.headTopY);
  ctx.lineTo(shaftOutline.tailTopX, shaftOutline.tailTopY);
  ctx.bezierCurveTo(
    shaftOutline.curveTopControl1X,
    shaftOutline.curveTopControl1Y,
    shaftOutline.curveTopControl2X,
    shaftOutline.curveTopControl2Y,
    shaftOutline.tailBackX,
    shaftOutline.tailBackY
  );
  ctx.bezierCurveTo(
    shaftOutline.curveBottomControl1X,
    shaftOutline.curveBottomControl1Y,
    shaftOutline.curveBottomControl2X,
    shaftOutline.curveBottomControl2Y,
    shaftOutline.tailBottomX,
    shaftOutline.tailBottomY
  );
  ctx.lineTo(shaftOutline.headBottomX, shaftOutline.headBottomY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  const [tip, leftPoint, rightPoint] = geometry.headPoints
    .split(' ')
    .map((pair) => pair.split(',').map(Number));

  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(leftPoint[0], leftPoint[1]);
  ctx.lineTo(rightPoint[0], rightPoint[1]);
  ctx.closePath();
  ctx.fill();
}

function drawLine(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: AnnotationShape,
  renderWidth: number,
  renderHeight: number,
  strokeWidth: number,
  color: string
) {
  const geometry = getAnnotationArrowRenderGeometry(shape, renderWidth, renderHeight, strokeWidth);

  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(geometry.tailX, geometry.tailY);
  ctx.lineTo(geometry.headX, geometry.headY);
  ctx.stroke();
}

function drawTextShape(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: AnnotationShape,
  left: number,
  top: number,
  width: number,
  height: number,
  referenceHeight: number
) {
  const fontSize = Math.max(1, shape.fontSize * (referenceHeight / 1080));
  ctx.font = `${shape.fontWeight} ${fontSize}px ${shape.fontFamily}`;
  ctx.fillStyle = shape.strokeColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(15, 23, 42, 0.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;

  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const lines = (shape.text || ANNOTATIONS.DEFAULT_TEXT).split('\n');
  const lineHeight = fontSize * 1.2;
  const firstLineY = centerY - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line: string, index: number) => {
    ctx.fillText(line, centerX, firstLineY + index * lineHeight, width);
  });
}

function drawStepShape(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: AnnotationShape,
  left: number,
  top: number,
  width: number,
  height: number
) {
  const diameter = Math.min(width, height);
  const radius = diameter / 2;
  const centerX = left + width / 2;
  const centerY = top + height / 2;
  const fontSize = Math.max(12, radius * 0.93);

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fillStyle = shape.fillColor;
  ctx.fill();

  ctx.font = `${Math.max(700, shape.fontWeight)} ${fontSize}px ${shape.fontFamily}`;
  ctx.fillStyle = ANNOTATIONS.DEFAULT_STEP_TEXT_COLOR;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(Math.max(1, Math.round(shape.number))), centerX, centerY);
}

export function drawAnnotationShape(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shape: AnnotationShape,
  renderWidth: number,
  renderHeight: number,
  referenceHeight: number
): void {
  const clampedShape = clampAnnotationShape(shape);
  const left = clampedShape.x * renderWidth;
  const top = clampedShape.y * renderHeight;
  const width = clampedShape.width * renderWidth;
  const height = clampedShape.height * renderHeight;
  const strokeWidth = Math.max(1, clampedShape.strokeWidth * (referenceHeight / 1080));

  ctx.save();
  ctx.globalAlpha = clampedShape.opacity;

  if (clampedShape.shapeType === 'text') {
    drawTextShape(ctx, clampedShape, left, top, width, height, referenceHeight);
    ctx.restore();
    return;
  }

  if (clampedShape.shapeType === 'step') {
    drawStepShape(ctx, clampedShape, left, top, width, height);
    ctx.restore();
    return;
  }

  if (clampedShape.shapeType === 'arrow') {
    drawArrow(ctx, clampedShape, renderWidth, renderHeight, strokeWidth, clampedShape.strokeColor);
    ctx.restore();
    return;
  }

  if (clampedShape.shapeType === 'line') {
    drawLine(ctx, clampedShape, renderWidth, renderHeight, strokeWidth, clampedShape.strokeColor);
    ctx.restore();
    return;
  }

  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = clampedShape.strokeColor;
  ctx.fillStyle = clampedShape.fillColor;
  ctx.lineJoin = 'round';

  if (clampedShape.shapeType === 'ellipse') {
    ctx.beginPath();
    ctx.ellipse(left + width / 2, top + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  } else {
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, Math.min(width, height) * 0.08);
  }

  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function renderAnnotationSegment(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  shapes: AnnotationShape[],
  renderWidth: number,
  renderHeight: number,
  referenceHeight: number
): void {
  for (const shape of shapes) {
    drawAnnotationShape(ctx, shape, renderWidth, renderHeight, referenceHeight);
  }
}

export function buildAnnotationOverlaySegments(
  segments: AnnotationSegment[],
  baseTextSegmentCount: number
): TextSegment[] {
  return segments.map((segment) => ({
    start: segment.startMs / 1000,
    end: segment.endMs / 1000,
    enabled: segment.enabled,
    content: `annotation-${baseTextSegmentCount}`,
    center: { x: 0.5, y: 0.5 },
    size: { x: 1, y: 1 },
    fontFamily: ANNOTATIONS.DEFAULT_FONT_FAMILY,
    fontSize: 1,
    fontWeight: 400,
    italic: false,
    color: '#ffffff',
    fadeDuration: 0,
    animation: 'none',
    typewriterCharsPerSecond: 1,
    typewriterSoundEnabled: false,
  }));
}
