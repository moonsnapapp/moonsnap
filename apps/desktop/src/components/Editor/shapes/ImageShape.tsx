import React from 'react';
import { Image } from 'react-konva';
import useImage from 'use-image';
import type { BaseShapeProps } from '../../../types';
import { useShapeCursor } from '../../../hooks/useShapeCursor';

interface ImageShapeProps extends BaseShapeProps {
  /** Pre-loaded source image for background shapes (avoids re-loading from imageSrc) */
  sourceImage?: HTMLImageElement;
}

type EditableImageShapeProps = Pick<
  ImageShapeProps,
  | 'shape'
  | 'isDraggable'
  | 'onClick'
  | 'onSelect'
  | 'onDragStart'
  | 'onDragEnd'
  | 'onTransformStart'
  | 'onTransformEnd'
> & {
  image: HTMLImageElement;
};

type ResolvedImageShapeProps = EditableImageShapeProps;

function getImageLoadSource(shape: ImageShapeProps['shape']): string {
  if (shape.isBackground) {
    return '';
  }

  return shape.imageSrc ?? '';
}

function getRenderableImage({
  shape,
  sourceImage,
  loadedImg,
}: {
  shape: ImageShapeProps['shape'];
  sourceImage: HTMLImageElement | undefined;
  loadedImg: HTMLImageElement | undefined;
}) {
  return shape.isBackground ? sourceImage : loadedImg;
}

function BackgroundImageShape({
  shape,
  image,
}: {
  shape: ImageShapeProps['shape'];
  image: HTMLImageElement;
}) {
  return (
    <Image
      id={shape.id}
      image={image}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      name="background"
      listening={false}
    />
  );
}

function EditableImageShape({
  shape,
  image,
  isDraggable,
  onClick,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
}: EditableImageShapeProps) {
  const cursorHandlers = useShapeCursor(isDraggable);

  return (
    <Image
      id={shape.id}
      image={image}
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
}

function ResolvedImageShape({
  shape,
  image,
  isDraggable,
  onClick,
  onSelect,
  onDragStart,
  onDragEnd,
  onTransformStart,
  onTransformEnd,
}: ResolvedImageShapeProps) {
  if (shape.isBackground) {
    return <BackgroundImageShape shape={shape} image={image} />;
  }

  return (
    <EditableImageShape
      shape={shape}
      image={image}
      isDraggable={isDraggable}
      onClick={onClick}
      onSelect={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    />
  );
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
  const [loadedImg] = useImage(getImageLoadSource(shape));
  const img = getRenderableImage({ shape, sourceImage, loadedImg });

  if (!img) return null;

  return (
    <ResolvedImageShape
      shape={shape}
      image={img}
      isDraggable={isDraggable}
      onClick={onClick}
      onSelect={onSelect}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onTransformStart={onTransformStart}
      onTransformEnd={onTransformEnd}
    />
  );
});

ImageShape.displayName = 'ImageShape';
