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

const FALLBACK_ARROW_DX = 1 / Math.sqrt(2);
const FALLBACK_ARROW_DY = -1 / Math.sqrt(2);
const ARROW_HEAD_HALF_ANGLE = Math.PI / 6;
const ARROW_HEAD_BASE_FACTOR = Math.cos(ARROW_HEAD_HALF_ANGLE);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getArrowLengthToBounds(
  startX: number,
  startY: number,
  unitX: number,
  unitY: number
): number {
  let maxDistance = Number.POSITIVE_INFINITY;

  if (Math.abs(unitX) > 0.0001) {
    maxDistance = Math.min(
      maxDistance,
      unitX > 0 ? (1 - startX) / unitX : (0 - startX) / unitX
    );
  }

  if (Math.abs(unitY) > 0.0001) {
    maxDistance = Math.min(
      maxDistance,
      unitY > 0 ? (1 - startY) / unitY : (0 - startY) / unitY
    );
  }

  return Math.max(0, maxDistance);
}

function clampArrowEndpoints(endpoints: AnnotationArrowEndpoints): AnnotationArrowEndpoints {
  const tailX = clamp01(endpoints.tailX);
  const tailY = clamp01(endpoints.tailY);
  let headX = clamp01(endpoints.headX);
  let headY = clamp01(endpoints.headY);

  let dx = headX - tailX;
  let dy = headY - tailY;
  const length = Math.hypot(dx, dy);

  if (length >= ANNOTATIONS.MIN_NORMALIZED_SIZE) {
    return { tailX, tailY, headX, headY };
  }

  const unitX = length > 0 ? dx / length : FALLBACK_ARROW_DX;
  const unitY = length > 0 ? dy / length : FALLBACK_ARROW_DY;
  const maxLength = getArrowLengthToBounds(tailX, tailY, unitX, unitY);
  const nextLength = Math.min(Math.max(maxLength, 0), ANNOTATIONS.MIN_NORMALIZED_SIZE);

  headX = clamp01(tailX + unitX * nextLength);
  headY = clamp01(tailY + unitY * nextLength);

  dx = headX - tailX;
  dy = headY - tailY;
  if (Math.hypot(dx, dy) > 0) {
    return { tailX, tailY, headX, headY };
  }

  return {
    tailX,
    tailY,
    headX: clamp01(tailX + FALLBACK_ARROW_DX * ANNOTATIONS.MIN_NORMALIZED_SIZE),
    headY: clamp01(tailY + FALLBACK_ARROW_DY * ANNOTATIONS.MIN_NORMALIZED_SIZE),
  };
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
    case 'text':
      return 'Text';
  }

  return 'Annotation';
}

export function createDefaultAnnotationShape(
  shapeType: AnnotationShapeType = ANNOTATIONS.DEFAULT_SHAPE_TYPE
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
    text: ANNOTATIONS.DEFAULT_TEXT,
    fontSize: ANNOTATIONS.DEFAULT_FONT_SIZE,
    fontFamily: ANNOTATIONS.DEFAULT_FONT_FAMILY,
    fontWeight: ANNOTATIONS.DEFAULT_FONT_WEIGHT,
  };

  if (shapeType === 'arrow') {
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
    };
  }

  return baseShape;
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

  if (mergedShape.shapeType === 'arrow') {
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
  if (shape.shapeType === 'arrow') {
    const clampedArrow = {
      ...shape,
      ...getAnnotationArrowShapeUpdate(shape, {}),
    };

    return {
      ...clampedArrow,
      strokeWidth: Math.min(
        ANNOTATIONS.MAX_STROKE_WIDTH,
        Math.max(ANNOTATIONS.MIN_STROKE_WIDTH, shape.strokeWidth)
      ),
      fontSize: Math.min(
        ANNOTATIONS.MAX_FONT_SIZE,
        Math.max(ANNOTATIONS.MIN_FONT_SIZE, shape.fontSize)
      ),
      opacity: Math.min(1, Math.max(0, shape.opacity)),
    };
  }

  const minSize = ANNOTATIONS.MIN_NORMALIZED_SIZE;
  const width = Math.min(1, Math.max(minSize, shape.width));
  const height = Math.min(1, Math.max(minSize, shape.height));
  const x = Math.min(1 - width, Math.max(0, shape.x));
  const y = Math.min(1 - height, Math.max(0, shape.y));

  return {
    ...shape,
    x,
    y,
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
  const shaftInset = Math.min(length * 0.8, headLength * ARROW_HEAD_BASE_FACTOR);
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

function drawArrow(
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
  ctx.lineTo(geometry.shaftEndX, geometry.shaftEndY);
  ctx.stroke();

  const [tip, leftPoint, rightPoint] = geometry.headPoints
    .split(' ')
    .map((pair) => pair.split(',').map(Number));

  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(leftPoint[0], leftPoint[1]);
  ctx.lineTo(rightPoint[0], rightPoint[1]);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
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

  if (clampedShape.shapeType === 'arrow') {
    drawArrow(ctx, clampedShape, renderWidth, renderHeight, strokeWidth, clampedShape.strokeColor);
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
