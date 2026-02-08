/**
 * UnifiedCaptionOverlay - Caption preview wrapper.
 *
 * Primary path: GPU glyphon preview via `render_caption_overlay`
 * to match export pixel-for-pixel.
 * Fallback path: CSS CaptionOverlay when GPU preview is unavailable.
 */

import { memo, useCallback, useState } from 'react';
import { CaptionOverlay } from './CaptionOverlay';
import { GPUCaptionOverlay } from './GPUCaptionOverlay';

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
  const [gpuActive, setGpuActive] = useState(false);
  const handleGpuActiveChange = useCallback((active: boolean) => {
    setGpuActive(active);
  }, []);

  return (
    <>
      <GPUCaptionOverlay
        containerWidth={containerWidth}
        containerHeight={containerHeight}
        onActiveChange={handleGpuActiveChange}
      />
      {!gpuActive && (
        <CaptionOverlay
          containerWidth={containerWidth}
          containerHeight={containerHeight}
          videoWidth={videoWidth}
          videoHeight={videoHeight}
        />
      )}
    </>
  );
});

export default UnifiedCaptionOverlay;
