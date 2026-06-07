import React from 'react';
import { Rect } from 'react-konva';
import type { CompositorSettings } from '../../types';
import { CompositorBackground } from './CompositorBackground';

interface VisibleBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface KonvaBackgroundLayerProps {
  /** Compositor settings from store */
  settings: CompositorSettings;
  /** Visible content bounds */
  visibleBounds: VisibleBounds | null;
  /** Base composition size (content + padding) */
  baseCompositionSize: { width: number; height: number };
}

function DefaultEditorShadow({ visibleBounds }: { visibleBounds: VisibleBounds }) {
  return (
    <Rect
      name="editor-shadow"
      x={visibleBounds.x - 2}
      y={visibleBounds.y - 2}
      width={visibleBounds.width + 4}
      height={visibleBounds.height + 4}
      fill="rgba(0,0,0,0.15)"
      cornerRadius={4}
      shadowColor="black"
      shadowBlur={24}
      shadowOpacity={0.25}
      listening={false}
    />
  );
}

function getCompositorBounds(visibleBounds: VisibleBounds, padding: number) {
  return {
    x: visibleBounds.x - padding,
    y: visibleBounds.y - padding,
    width: visibleBounds.width + padding * 2,
    height: visibleBounds.height + padding * 2,
  };
}

function ContentShadow({
  visibleBounds,
  settings,
}: {
  visibleBounds: VisibleBounds;
  settings: CompositorSettings;
}) {
  if (settings.shadowIntensity <= 0) {
    return null;
  }

  return (
    <Rect
      name="content-shadow"
      x={visibleBounds.x}
      y={visibleBounds.y}
      width={visibleBounds.width}
      height={visibleBounds.height}
      cornerRadius={settings.borderRadius}
      fill="#000000"
      shadowColor="black"
      shadowBlur={30 * settings.shadowIntensity}
      shadowOffsetY={10 * settings.shadowIntensity}
      shadowOpacity={0.4 * settings.shadowIntensity}
      shadowEnabled={true}
      listening={false}
    />
  );
}

function KonvaCompositorBackgroundLayer({
  settings,
  visibleBounds,
}: {
  settings: CompositorSettings;
  visibleBounds: VisibleBounds;
}) {
  const compBounds = getCompositorBounds(visibleBounds, settings.padding);

  return (
    <>
      <ContentShadow visibleBounds={visibleBounds} settings={settings} />
      <CompositorBackground
        name="compositor-background"
        settings={settings}
        bounds={compBounds}
        borderRadius={0}
        includeShadow={false}
      />
    </>
  );
}

/**
 * Renders the Konva-side background layer for the editor canvas.
 * Handles both:
 * - Default shadow when compositor is disabled
 * - Compositor background, shadows, and border radius when enabled
 */
export const KonvaBackgroundLayer: React.FC<KonvaBackgroundLayerProps> = ({
  settings,
  visibleBounds,
  baseCompositionSize,
}) => {
  if (!visibleBounds) return null;

  // Default shadow when compositor disabled
  if (!settings.enabled) {
    return <DefaultEditorShadow visibleBounds={visibleBounds} />;
  }

  // Compositor background (with padding)
  // Simple calculation: content bounds expanded by padding on each side
  if (baseCompositionSize.width <= 0) return null;

  return <KonvaCompositorBackgroundLayer settings={settings} visibleBounds={visibleBounds} />;
};

export default KonvaBackgroundLayer;
