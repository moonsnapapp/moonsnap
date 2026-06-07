import React from 'react';
import { Rect, Group, Image } from 'react-konva';
import type Konva from 'konva';
import type { CompositorSettings } from '../../types';
import {
  useCompositorBackgroundImage,
  calculateGradientPoints,
  gradientColorsToKonva,
  calculateCoverSize,
} from '../../hooks/useCompositorBackground';

interface CompositorBackgroundProps {
  settings: CompositorSettings;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  borderRadius?: number;
  includeShadow?: boolean;
  name?: string;
}

type BackgroundBounds = CompositorBackgroundProps['bounds'];
type ShadowProps = ReturnType<typeof getBackgroundShadowProps>;

function getBackgroundShadowProps(settings: CompositorSettings, includeShadow: boolean) {
  return includeShadow && settings.shadowIntensity > 0
    ? {
        shadowColor: 'black',
        shadowBlur: 32 * settings.shadowIntensity,
        shadowOffsetY: 8 * settings.shadowIntensity,
        shadowOpacity: 0.35 * settings.shadowIntensity,
      }
    : {};
}

function BackgroundRect({
  settings,
  bounds,
  borderRadius,
  shadowProps,
  name,
}: {
  settings: CompositorSettings;
  bounds: BackgroundBounds;
  borderRadius: number;
  shadowProps: ShadowProps;
  name?: string;
}) {
  return (
    <Rect
      name={name}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      fill={settings.backgroundColor}
      cornerRadius={borderRadius}
      listening={false}
      {...shadowProps}
    />
  );
}

function GradientBackgroundRect({
  settings,
  bounds,
  borderRadius,
  shadowProps,
  name,
}: {
  settings: CompositorSettings;
  bounds: BackgroundBounds;
  borderRadius: number;
  shadowProps: ShadowProps;
  name?: string;
}) {
  const gradientPoints = calculateGradientPoints(
    settings.gradientAngle,
    bounds.width,
    bounds.height,
    0,
    0
  );

  return (
    <Rect
      name={name}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      fillLinearGradientStartPoint={{
        x: gradientPoints.x1,
        y: gradientPoints.y1,
      }}
      fillLinearGradientEndPoint={{
        x: gradientPoints.x2,
        y: gradientPoints.y2,
      }}
      fillLinearGradientColorStops={gradientColorsToKonva(settings.gradientStart, settings.gradientEnd)}
      cornerRadius={borderRadius}
      listening={false}
      {...shadowProps}
    />
  );
}

function FallbackImageBackground({
  bounds,
  borderRadius,
  shadowProps,
  name,
}: {
  bounds: BackgroundBounds;
  borderRadius: number;
  shadowProps: ShadowProps;
  name?: string;
}) {
  return (
    <Rect
      name={name}
      x={bounds.x}
      y={bounds.y}
      width={bounds.width}
      height={bounds.height}
      fill="#1a1a2e"
      cornerRadius={borderRadius}
      listening={false}
      {...shadowProps}
    />
  );
}

function drawRoundedBackgroundClip(
  ctx: Konva.Context,
  bounds: BackgroundBounds,
  borderRadius: number
) {
  const r = Math.min(borderRadius, bounds.width / 2, bounds.height / 2);
  ctx.beginPath();
  ctx.moveTo(bounds.x + r, bounds.y);
  ctx.arcTo(bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + bounds.height, r);
  ctx.arcTo(bounds.x + bounds.width, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height, r);
  ctx.arcTo(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y, r);
  ctx.arcTo(bounds.x, bounds.y, bounds.x + bounds.width, bounds.y, r);
  ctx.closePath();
}

function drawRectBackgroundClip(ctx: Konva.Context, bounds: BackgroundBounds) {
  ctx.beginPath();
  ctx.rect(bounds.x, bounds.y, bounds.width, bounds.height);
  ctx.closePath();
}

function ImageBackground({
  backgroundImage,
  bounds,
  borderRadius,
  shadowProps,
  name,
}: {
  backgroundImage: HTMLImageElement;
  bounds: BackgroundBounds;
  borderRadius: number;
  shadowProps: ShadowProps;
  name?: string;
}) {
  const cover = calculateCoverSize(
    backgroundImage.width,
    backgroundImage.height,
    bounds.width,
    bounds.height
  );

  return (
    <Group
      name={name}
      clipFunc={(ctx) => {
        if (borderRadius > 0) {
          drawRoundedBackgroundClip(ctx, bounds, borderRadius);
          return;
        }
        drawRectBackgroundClip(ctx, bounds);
      }}
    >
      <Image
        image={backgroundImage}
        x={bounds.x + cover.offsetX}
        y={bounds.y + cover.offsetY}
        width={cover.width}
        height={cover.height}
        listening={false}
        {...shadowProps}
      />
    </Group>
  );
}

function isImageBackgroundType(backgroundType: CompositorSettings['backgroundType']) {
  return backgroundType === 'image' || backgroundType === 'wallpaper';
}

function renderImageBackground({
  backgroundImage,
  bounds,
  borderRadius,
  shadowProps,
  name,
}: {
  backgroundImage: HTMLImageElement | null | undefined;
  bounds: BackgroundBounds;
  borderRadius: number;
  shadowProps: ShadowProps;
  name?: string;
}) {
  if (!backgroundImage) {
    return (
      <FallbackImageBackground
        bounds={bounds}
        borderRadius={borderRadius}
        shadowProps={shadowProps}
        name={name}
      />
    );
  }

  return (
    <ImageBackground
      backgroundImage={backgroundImage}
      bounds={bounds}
      borderRadius={borderRadius}
      shadowProps={shadowProps}
      name={name}
    />
  );
}

function renderCompositorBackground({
  settings,
  bounds,
  borderRadius,
  shadowProps,
  name,
  backgroundImage,
}: {
  settings: CompositorSettings;
  bounds: BackgroundBounds;
  borderRadius: number;
  shadowProps: ShadowProps;
  name?: string;
  backgroundImage: HTMLImageElement | null | undefined;
}) {
  if (settings.backgroundType === 'solid') {
    return (
      <BackgroundRect
        settings={settings}
        bounds={bounds}
        borderRadius={borderRadius}
        shadowProps={shadowProps}
        name={name}
      />
    );
  }

  if (settings.backgroundType === 'gradient') {
    return (
      <GradientBackgroundRect
        settings={settings}
        bounds={bounds}
        borderRadius={borderRadius}
        shadowProps={shadowProps}
        name={name}
      />
    );
  }

  if (isImageBackgroundType(settings.backgroundType)) {
    return renderImageBackground({ backgroundImage, bounds, borderRadius, shadowProps, name });
  }

  return null;
}

/**
 * Renders the compositor background as Konva elements.
 * Single source of truth - use this for both preview and export.
 */
export const CompositorBackground: React.FC<CompositorBackgroundProps> = ({
  settings,
  bounds,
  borderRadius = 0,
  includeShadow = false,
  name,
}) => {
  const backgroundImage = useCompositorBackgroundImage(
    settings.backgroundType,
    settings.backgroundImage
  );

  if (!settings.enabled) return null;

  const shadowProps = getBackgroundShadowProps(settings, includeShadow);

  return renderCompositorBackground({
    settings,
    bounds,
    borderRadius,
    shadowProps,
    name,
    backgroundImage,
  });
};

export default CompositorBackground;
