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

function buildSquirclePolygon(
  radiusFactor: number,
  width: number,
  height: number,
  numPoints: number
): string {
  if (radiusFactor <= 0.001) {
    return 'polygon(0% 0%, 100% 0%, 100% 100%, 0% 100%)';
  }

  // For non-square elements, use the smaller dimension so corners are circular
  const minDim = Math.min(width, height);
  const radiusPx = radiusFactor * minDim;
  const rx = (radiusPx / width) * 100;  // radius as % of width
  const ry = (radiusPx / height) * 100; // radius as % of height

  const superellipsePoint = (t: number): { x: number; y: number } => {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    return {
      x: Math.sign(cosT) * Math.pow(Math.abs(cosT), SUPERELLIPSE_EXP),
      y: Math.sign(sinT) * Math.pow(Math.abs(sinT), SUPERELLIPSE_EXP),
    };
  };

  const points: string[] = [];
  const HALF_PI = Math.PI / 2;

  // Top-right corner (t: -PI/2 to 0)
  for (let i = 0; i <= numPoints; i++) {
    const t = -HALF_PI + HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push(`${(100 - rx + p.x * rx).toFixed(2)}% ${(ry + p.y * ry).toFixed(2)}%`);
  }

  // Bottom-right corner (t: 0 to PI/2)
  for (let i = 1; i <= numPoints; i++) {
    const t = HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push(`${(100 - rx + p.x * rx).toFixed(2)}% ${(100 - ry + p.y * ry).toFixed(2)}%`);
  }

  // Bottom-left corner (t: PI/2 to PI)
  for (let i = 1; i <= numPoints; i++) {
    const t = HALF_PI + HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push(`${(rx + p.x * rx).toFixed(2)}% ${(100 - ry + p.y * ry).toFixed(2)}%`);
  }

  // Top-left corner (t: PI to 3*PI/2)
  for (let i = 1; i <= numPoints; i++) {
    const t = Math.PI + HALF_PI * (i / numPoints);
    const p = superellipsePoint(t);
    points.push(`${(rx + p.x * rx).toFixed(2)}% ${(ry + p.y * ry).toFixed(2)}%`);
  }

  return `polygon(${points.join(', ')})`;
}
