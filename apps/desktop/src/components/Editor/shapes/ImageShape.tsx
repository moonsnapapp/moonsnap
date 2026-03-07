import React from 'react';
import { Image } from 'react-konva';
import useImage from 'use-image';
import type { BaseShapeProps } from '../../../types';
import { useShapeCursor } from '../../../hooks/useShapeCursor';

interface ImageShapeProps extends BaseShapeProps {
  /** Pre-loaded source image for background shapes (avoids re-loading from imageSrc) */
  sourceImage?: HTMLImageElement;
}

export const ImageShape: React.FC<ImageShapeProps> = React.memo(({
  shape,
  isDraggable,
  onClick,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
  sourceImage,
}) => {
  const cursorHandlers = useShapeCursor(isDraggable);
  const [loadedImg] = useImage(shape.isBackground ? '' : (shape.imageSrc ?? ''));

  // Background shapes use the pre-loaded sourceImage; pasted images load their own
  const img = shape.isBackground ? sourceImage : loadedImg;

  if (!img) return null;

  // Background image: not interactive — clicks pass through to stage
  if (shape.isBackground) {
    return (
      <Image
        id={shape.id}
        image={img}
        x={shape.x}
        y={shape.y}
        width={shape.width}
        height={shape.height}
        name="background"
        listening={false}
      />
    );
  }

  return (
    <Image
      id={shape.id}
      image={img}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      rotation={shape.rotation}
      draggable={isDraggable}
      onClick={onClick}
      onTap={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
      {...cursorHandlers}
    />
  );
});

ImageShape.displayName = 'ImageShape';
