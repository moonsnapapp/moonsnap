import React from 'react';
import type { CompositorSettings } from '../../types';
import { getEditorShadowCss, getEditorShadowLayers } from '@/utils/frameEffects';

interface CompositionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface CompositorCssPreviewProps {
  /** Ref to attach to the preview div for coordinated transforms */
  previewRef?: React.RefObject<HTMLDivElement | null>;
  /** Compositor settings from store */
  settings: CompositorSettings;
  /** Computed composition box position/size in screen coordinates */
  compositionBox: CompositionBox;
  /** Current zoom level */
  zoom: number;
  /** Background style computed from settings */
  backgroundStyle: React.CSSProperties;
  /** When true, artboard has transparent areas — skip shadow and border-radius */
  hasTransparency?: boolean;
}

/**
 * Renders the CSS-based compositor preview background.
 * This sits behind the Konva canvas and provides a smooth preview
 * of the compositor background during pan/zoom operations.
 */
export const CompositorCssPreview: React.FC<CompositorCssPreviewProps> = ({
  previewRef,
  settings,
  compositionBox,
  zoom,
  backgroundStyle,
  hasTransparency = false,
}) => {
  if (!settings.enabled) return null;

  // Shadow position is simply the padding offset within the composition box
  // Content sits at (padding, padding) within the compositor area
  const scaledPadding = settings.padding * zoom;
  const contentWidth = compositionBox.width - scaledPadding * 2;
  const contentHeight = compositionBox.height - scaledPadding * 2;
  const shadowLayers = getEditorShadowLayers(settings.shadowIntensity);

  return (
    <div
      ref={previewRef}
      className="absolute pointer-events-none"
      style={{
        left: compositionBox.left,
        top: compositionBox.top,
        width: compositionBox.width,
        height: compositionBox.height,
        zIndex: 0,
        willChange: 'transform',
        contain: 'layout style paint',
        ...backgroundStyle,
      }}
    >
      {shadowLayers.length > 0 && !hasTransparency && (
        <div
          style={{
            position: 'absolute',
            left: scaledPadding,
            top: scaledPadding,
            width: contentWidth,
            height: contentHeight,
            borderRadius: settings.borderRadius * zoom,
            boxShadow: getEditorShadowCss(shadowLayers),
          }}
        />
      )}
    </div>
  );
};

export default CompositorCssPreview;
