/**
 * Superellipse (squircle) clip-path generation.
 *
 * Uses the parametric form: x = a * sign(cos(t)) * |cos(t)|^(2/n)
 * where n=4 for squircle (matches Cap's shader power=4).
 */

const SUPERELLIPSE_POWER = 4;
const SUPERELLIPSE_EXP = 2 / SUPERELLIPSE_POWER; // 0.5

/**
 * Generate a superellipse (squircle) CSS polygon clip-path.
 *
 * @param rounding - Rounding percentage (0-100): 0% = rectangle, 100% = full squircle
 * @param width - Element width in pixels (for aspect-ratio-correct circular corners)
 * @param height - Element height in pixels
 * @param numPoints - Points per corner for curve smoothness
 */
export function generateSquircleClipPath(
  rounding: number,
  width: number = 100,
  height: number = 100,
  numPoints: number = 16
): string {
  const radiusFactor = (rounding / 100) * 0.5; // 0 to 0.5
  return buildSquirclePolygon(radiusFactor, width, height, numPoints);
}

/**
 * Generate a superellipse clip-path from a pixel corner radius.
 *
 * @param radiusPx - Corner radius in pixels
 * @param width - Element width in pixels
 * @param height - Element height in pixels
 * @param numPoints - Points per corner for curve smoothness
 */
export function generateSquircleClipPathFromRadius(
  radiusPx: number,
  width: number,
  height: number,
  numPoints: number = 16
): string {
  const minDim = Math.min(width, height);
  if (minDim <= 0) return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  // radiusFactor is the fraction of the smaller dimension used as corner radius (0 to 0.5)
  const radiusFactor = Math.min(radiusPx / minDim, 0.5);
  return buildSquirclePolygon(radiusFactor, width, height, numPoints);
}

/**
 * Generate squircle points as percentage coordinates {x, y} (0-100).
 */
function generateSquirclePoints(
  radiusFactor: number,
  width: number,
  height: number,
  numPoints: number
): Array<{ x: number; y: number }> {
  if (radiusFactor <= 0.001) {
    return [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  }

  const minDim = Math.min(width, height);
  const radiusPx = radiusFactor * minDim;
  const rx = (radiusPx / width) * 100;
  const ry = (radiusPx / height) * 100;

  const superellipsePoint = (t: number): { x: number; y: number } => {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    return {
      x: Math.sign(cosT) * Math.pow(Math.abs(cosT), SUPERELLIPSE_EXP),
      y: Math.sign(sinT) * Math.pow(Math.abs(sinT), SUPERELLIPSE_EXP),
    };
  };

  const points: Array<{ x: number; y: number }> = [];
  const HALF_PI = Math.PI / 2;

  // Top-right corner (t: -PI/2 to 0)
  for (let i = 0; i <= numPoints; i++) {
    const t = -HALF_PI + HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push({ x: 100 - rx + p.x * rx, y: ry + p.y * ry });
  }

  // Bottom-right corner (t: 0 to PI/2)
  for (let i = 1; i <= numPoints; i++) {
    const t = HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push({ x: 100 - rx + p.x * rx, y: 100 - ry + p.y * ry });
  }

  // Bottom-left corner (t: PI/2 to PI)
  for (let i = 1; i <= numPoints; i++) {
    const t = HALF_PI + HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push({ x: rx + p.x * rx, y: 100 - ry + p.y * ry });
  }

  // Top-left corner (t: PI to 3*PI/2)
  for (let i = 1; i <= numPoints; i++) {
    const t = Math.PI + HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push({ x: rx + p.x * rx, y: ry + p.y * ry });
  }

  return points;
}

function pointsToPolygon(points: Array<{ x: number; y: number }>): string {
  return `polygon(${points.map(p => `${p.x.toFixed(2)}% ${p.y.toFixed(2)}%`).join(', ')})`;
}

function buildSquirclePolygon(
  radiusFactor: number,
  width: number,
  height: number,
  numPoints: number
): string {
  return pointsToPolygon(generateSquirclePoints(radiusFactor, width, height, numPoints));
}

/**
 * Generate a ring-shaped clip-path for a squircle border.
 *
 * Uses `path(evenodd, "outerRect innerSquircle")` with two separate
 * SVG sub-paths (M...Z M...Z). This avoids the bridge-edge artifacts
 * that CSS `polygon(evenodd, ...)` creates since polygon is a single
 * path. The parent's squircle clip-path clips the outer rect to the
 * squircle shape, producing a border with squircle curves on both edges.
 *
 * @param radiusPx - Outer corner radius in CSS pixels
 * @param borderWidthPx - Border width in CSS pixels
 * @param width - Element width in CSS pixels
 * @param height - Element height in CSS pixels
 */
export function generateSquircleBorderClipPath(
  radiusPx: number,
  borderWidthPx: number,
  width: number,
  height: number,
  numPoints: number = 16
): string {
  const innerWidth = width - 2 * borderWidthPx;
  const innerHeight = height - 2 * borderWidthPx;

  // Outer squircle points (full element size)
  const outerMinDim = Math.min(width, height);
  const outerRadiusFactor = outerMinDim > 0 ? Math.min(radiusPx / outerMinDim, 0.5) : 0;
  const outerPctPoints = generateSquirclePoints(outerRadiusFactor, width, height, numPoints);
  const outerPxPoints = outerPctPoints.map(p => ({
    x: (p.x / 100) * width,
    y: (p.y / 100) * height,
  }));

  if (innerWidth <= 0 || innerHeight <= 0) {
    const f = outerPxPoints[0];
    const r = outerPxPoints.slice(1);
    return `path("M${f.x.toFixed(2)},${f.y.toFixed(2)} ${r.map(p => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z")`;
  }

  const innerRadiusPx = Math.max(0, radiusPx - borderWidthPx);
  const innerMinDim = Math.min(innerWidth, innerHeight);
  const innerRadiusFactor = innerMinDim > 0 ? Math.min(innerRadiusPx / innerMinDim, 0.5) : 0;
  const innerPctPoints = generateSquirclePoints(innerRadiusFactor, innerWidth, innerHeight, numPoints);
  const innerPxPoints = innerPctPoints.map(p => ({
    x: borderWidthPx + (p.x / 100) * innerWidth,
    y: borderWidthPx + (p.y / 100) * innerHeight,
  }));

  // Outer squircle sub-path
  const of = outerPxPoints[0];
  const or = outerPxPoints.slice(1);
  const outer = `M${of.x.toFixed(2)},${of.y.toFixed(2)} ${or.map(p => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`;

  // Inner squircle sub-path (hole)
  const inf = innerPxPoints[0];
  const inr = innerPxPoints.slice(1);
  const inner = `M${inf.x.toFixed(2)},${inf.y.toFixed(2)} ${inr.map(p => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ')} Z`;

  return `path(evenodd, "${outer} ${inner}")`;
}
