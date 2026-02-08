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
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
  videoWidth: number;
  videoHeight: number;
}

export const UnifiedCaptionOverlay = memo(function UnifiedCaptionOverlay({
  renderWidth,
  renderHeight,
  displayWidth,
  displayHeight,
  videoWidth,
  videoHeight,
}: UnifiedCaptionOverlayProps) {
  const [gpuActive, setGpuActive] = useState(false);
  const handleGpuActiveChange = useCallback((active: boolean) => {
    setGpuActive(active);
  }, []);

  const safeRenderWidth = Math.max(1, Math.round(renderWidth));
  const safeRenderHeight = Math.max(1, Math.round(renderHeight));
  const safeDisplayWidth = Math.max(1, Math.round(displayWidth));
  const safeDisplayHeight = Math.max(1, Math.round(displayHeight));
  const scaleX = safeDisplayWidth / safeRenderWidth;
  const scaleY = safeDisplayHeight / safeRenderHeight;

  return (
    <>
      <GPUCaptionOverlay
        renderWidth={safeRenderWidth}
        renderHeight={safeRenderHeight}
        displayWidth={safeDisplayWidth}
        displayHeight={safeDisplayHeight}
        onActiveChange={handleGpuActiveChange}
      />
      {!gpuActive && (
        <div
          className="absolute left-0 top-0 z-50 pointer-events-none"
          style={{
            width: `${safeDisplayWidth}px`,
            height: `${safeDisplayHeight}px`,
          }}
          aria-hidden
        >
          <div
            style={{
              position: 'relative',
              width: `${safeRenderWidth}px`,
              height: `${safeRenderHeight}px`,
              transform: `scale(${scaleX}, ${scaleY})`,
              transformOrigin: 'top left',
            }}
          >
            <CaptionOverlay
              containerWidth={safeRenderWidth}
              containerHeight={safeRenderHeight}
              videoWidth={videoWidth}
              videoHeight={videoHeight}
            />
          </div>
        </div>
      )}
    </>
  );
});

export default UnifiedCaptionOverlay;
