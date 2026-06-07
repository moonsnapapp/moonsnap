import React from 'react';
import { Ellipse } from 'react-konva';
import type { BaseShapeProps } from '../../../types';
import { useShapeNodeProps } from './useShapeNodeProps';

function getCircleShapeRadius(value: number | undefined, fallback: number | undefined) {
  return value ?? fallback ?? 0;
}

function getCircleShapeRadii(shape: BaseShapeProps['shape']) {
  return {
    radiusX: getCircleShapeRadius(shape.radiusX, shape.radius),
    radiusY: getCircleShapeRadius(shape.radiusY, shape.radius),
  };
}

export const CircleShape: React.FC<BaseShapeProps> = React.memo((props) => {
  const { shape } = props;
  const shapeNodeProps = useShapeNodeProps(props);
  const { radiusX, radiusY } = getCircleShapeRadii(shape);

  return (
    <Ellipse
      {...shapeNodeProps}
      x={shape.x}
      y={shape.y}
      radiusX={radiusX}
      radiusY={radiusY}
      stroke={shape.stroke}
      strokeWidth={shape.strokeWidth}
      fill={shape.fill}
      rotation={shape.rotation}
    />
  );
});

CircleShape.displayName = 'CircleShape';
