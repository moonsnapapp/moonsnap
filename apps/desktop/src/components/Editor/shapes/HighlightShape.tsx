import React from 'react';
import { Rect } from 'react-konva';
import type { BaseShapeProps } from '../../../types';
import { useShapeNodeProps } from './useShapeNodeProps';

export const HighlightShape: React.FC<BaseShapeProps> = React.memo((props) => {
  const { shape } = props;
  const shapeNodeProps = useShapeNodeProps(props);

  return (
    <Rect
      {...shapeNodeProps}
      x={shape.x}
      y={shape.y}
      width={shape.width}
      height={shape.height}
      fill={shape.fill}
      rotation={shape.rotation}
    />
  );
});

HighlightShape.displayName = 'HighlightShape';
