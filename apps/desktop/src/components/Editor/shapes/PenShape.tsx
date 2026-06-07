import React from 'react';
import { Line } from 'react-konva';
import type { BaseShapeProps } from '../../../types';
import { useShapeNodeProps } from './useShapeNodeProps';

export const PenShape: React.FC<BaseShapeProps> = React.memo((props) => {
  const { shape } = props;
  const shapeNodeProps = useShapeNodeProps(props);

  return (
    <Line
      {...shapeNodeProps}
      points={shape.points || []}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      hitStrokeWidth={Math.max(20, (shape.strokeWidth || 2) * 3)}
      tension={0.5}
      lineCap="round"
      lineJoin="round"
      globalCompositeOperation="source-over"
    />
  );
});

PenShape.displayName = 'PenShape';
