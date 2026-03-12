import { invoke } from '@tauri-apps/api/core';
import type { AnnotationSegment } from '@/types';
import { renderAnnotationSegment } from '@/utils/videoAnnotations';

function preRenderAnnotationSegment(
  segment: AnnotationSegment,
  exportWidth: number,
  exportHeight: number
): Uint8Array | null {
  if (!segment.enabled || segment.shapes.length === 0) {
    return null;
  }

  const canvas = new OffscreenCanvas(exportWidth, exportHeight);
  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) {
    return null;
  }

  ctx.clearRect(0, 0, exportWidth, exportHeight);
  renderAnnotationSegment(ctx, segment.shapes, exportWidth, exportHeight, exportHeight);
  const imageData = ctx.getImageData(0, 0, exportWidth, exportHeight);
  return new Uint8Array(imageData.data.buffer);
}

export async function preRenderAnnotationsForExport(
  segments: AnnotationSegment[],
  exportWidth: number,
  exportHeight: number,
  startIndex: number
): Promise<void> {
  const registrations: Promise<void>[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const rgbaData = preRenderAnnotationSegment(segments[index], exportWidth, exportHeight);
    if (!rgbaData) {
      continue;
    }

    registrations.push(
      invoke('register_prerendered_text', {
        segmentIndex: startIndex + index,
        width: exportWidth,
        height: exportHeight,
        centerX: 0.5,
        centerY: 0.5,
        sizeX: 1,
        sizeY: 1,
        rgbaData,
      }),
    );
  }

  await Promise.all(registrations);
}
