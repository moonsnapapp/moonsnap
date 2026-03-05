import Konva from 'konva';
import { writeFile } from '@tauri-apps/plugin-fs';
import type { CompositorSettings, CanvasBounds } from '../types';
import { compositeImage } from './compositor';

export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Get content dimensions from cropRegion, canvas bounds, or background image.
 * If cropRegion is set, it takes priority as export bounds.
 */
export function getContentBounds(
  stage: Konva.Stage,
  canvasBounds: CanvasBounds | null,
  cropRegion?: { x: number; y: number; width: number; height: number } | null
): ContentBounds {
  // cropRegion takes priority — it defines export-only bounds
  if (cropRegion) {
    return {
      x: cropRegion.x,
      y: cropRegion.y,
      width: cropRegion.width,
      height: cropRegion.height,
    };
  }

  const imageNode = stage.findOne('[name=background]') as Konva.Image | undefined;
  return {
    width: canvasBounds?.width || imageNode?.width() || 800,
    height: canvasBounds?.height || imageNode?.height() || 600,
    x: canvasBounds ? -canvasBounds.imageOffsetX : 0,
    y: canvasBounds ? -canvasBounds.imageOffsetY : 0,
  };
}

/**
 * Calculate export bounds with compositor padding if enabled
 */
export function calculateExportBounds(
  content: ContentBounds,
  compositorSettings: CompositorSettings
): ExportBounds {
  if (compositorSettings.enabled) {
    const padding = compositorSettings.padding;
    return {
      x: Math.round(content.x - padding),
      y: Math.round(content.y - padding),
      width: Math.round(content.width + padding * 2),
      height: Math.round(content.height + padding * 2),
    };
  }
  return {
    x: Math.round(content.x),
    y: Math.round(content.y),
    width: Math.round(content.width),
    height: Math.round(content.height),
  };
}

/**
 * Export canvas to HTMLCanvasElement, temporarily hiding editor-only elements
 */
export function exportCanvas(
  stage: Konva.Stage,
  layer: Konva.Layer,
  bounds: ExportBounds
): HTMLCanvasElement {
  // Save current transform
  const savedScale = { x: stage.scaleX(), y: stage.scaleY() };
  const savedPosition = { x: stage.x(), y: stage.y() };

  // Reset stage transform to 1:1 for pixel-accurate export
  stage.scale({ x: 1, y: 1 });
  stage.position({ x: 0, y: 0 });

  // Physically remove editor-only nodes from the scene graph before export.
  // hide()/show() is unreliable with layer.toCanvas(), so we remove() and re-add().
  const removedNodes: { node: Konva.Node; parent: Konva.Container; index: number }[] = [];

  const removeForExport = (node: Konva.Node | undefined | null) => {
    if (!node) return;
    const parent = node.getParent();
    if (!parent) return;
    const index = parent.children ? parent.children.indexOf(node) : -1;
    removedNodes.push({ node, parent, index });
    node.remove();
  };

  // Search from layer (not stage) using .name selector — works inside clip groups
  removeForExport(layer.findOne('.checkerboard'));
  removeForExport(layer.findOne('.editor-shadow'));
  removeForExport(layer.findOne('.compositor-bg'));
  removeForExport(layer.findOne('.transformer'));

  // Remove all gizmo elements (selection handles, crop overlay, artboard, etc.)
  layer.find('.editor-gizmo').forEach((n) => removeForExport(n));

  // Export from Konva
  const outputCanvas = layer.toCanvas({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    pixelRatio: 1,
  });

  // Restore all removed nodes back to their original positions
  stage.scale(savedScale);
  stage.position(savedPosition);

  for (const { node, parent, index } of removedNodes) {
    if (index >= 0 && parent.children && index < parent.children.length) {
      // Insert back at original position
      parent.children.splice(index, 0, node);
      node.parent = parent;
    } else {
      parent.add(node);
    }
  }
  layer.batchDraw();

  return outputCanvas;
}

// ============================================================================
// High-Level Export Utilities
// ============================================================================

export interface ExportOptions {
  format: 'image/png' | 'image/jpeg' | 'image/webp';
  quality?: number; // 0-1 for jpeg/webp
}

/**
 * Export the current canvas state to a Blob.
 * Handles stage reset, layer finding, bounds calculation, and compositor effects.
 */
export async function exportToBlob(
  stageRef: React.RefObject<Konva.Stage | null>,
  canvasBounds: CanvasBounds | null,
  compositorSettings: CompositorSettings,
  options: ExportOptions = { format: 'image/png' },
  cropRegion?: { x: number; y: number; width: number; height: number } | null
): Promise<Blob> {
  const stage = stageRef.current;
  if (!stage) throw new Error('Stage not available');

  const layer = stage.findOne('Layer') as Konva.Layer | undefined;
  if (!layer) throw new Error('Layer not found');

  // Export raw content from Konva (without compositor padding)
  const content = getContentBounds(stage, canvasBounds, cropRegion);
  const rawBounds: ExportBounds = {
    x: Math.round(content.x),
    y: Math.round(content.y),
    width: Math.round(content.width),
    height: Math.round(content.height),
  };
  const rawCanvas = exportCanvas(stage, layer, rawBounds);

  // Apply compositor effects (background, shadow, padding, border radius)
  const outputCanvas = await compositeImage({
    settings: compositorSettings,
    sourceCanvas: rawCanvas,
    canvasBounds: null, // Already handled in rawBounds
  });

  return new Promise<Blob>((resolve, reject) => {
    outputCanvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to create blob'))),
      options.format,
      options.quality
    );
  });
}

/**
 * Export canvas and copy to clipboard.
 */
export async function exportToClipboard(
  stageRef: React.RefObject<Konva.Stage | null>,
  canvasBounds: CanvasBounds | null,
  compositorSettings: CompositorSettings,
  cropRegion?: { x: number; y: number; width: number; height: number } | null
): Promise<void> {
  const blob = await exportToBlob(stageRef, canvasBounds, compositorSettings, { format: 'image/png' }, cropRegion);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/**
 * Export canvas to file using Tauri's writeFile.
 */
export async function exportToFile(
  stageRef: React.RefObject<Konva.Stage | null>,
  canvasBounds: CanvasBounds | null,
  compositorSettings: CompositorSettings,
  filePath: string,
  options: ExportOptions = { format: 'image/png' },
  cropRegion?: { x: number; y: number; width: number; height: number } | null
): Promise<void> {
  const blob = await exportToBlob(stageRef, canvasBounds, compositorSettings, options, cropRegion);
  const arrayBuffer = await blob.arrayBuffer();
  await writeFile(filePath, new Uint8Array(arrayBuffer));
}
