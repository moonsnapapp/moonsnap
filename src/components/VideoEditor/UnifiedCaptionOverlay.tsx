/**
 * UnifiedCaptionOverlay - Caption preview wrapper.
 *
 * Uses CSS-based CaptionOverlay which now matches export rendering:
 * - Both scale by height/1080 reference resolution
 * - Line height: 1.2 (matches glyphon Metrics)
 * - Padding: 40px * scale (matches export)
 * - Font size: settings.size * scale (matches export)
 * - Max width: containerWidth - padding*2 (matches export)
 */

import { memo } from 'react';
import { CaptionOverlay } from './CaptionOverlay';

interface UnifiedCaptionOverlayProps {
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
}

export const UnifiedCaptionOverlay = memo(function UnifiedCaptionOverlay({
  containerWidth,
  containerHeight,
  videoWidth,
  videoHeight,
}: UnifiedCaptionOverlayProps) {
  return (
    <CaptionOverlay
      containerWidth={containerWidth}
      containerHeight={containerHeight}
      videoWidth={videoWidth}
      videoHeight={videoHeight}
    />
  );
});

export default UnifiedCaptionOverlay;
