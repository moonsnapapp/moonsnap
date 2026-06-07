import React from 'react';
import { Group, Circle, Text } from 'react-konva';
import type { BaseShapeProps } from '../../../types';
import { useShapeNodeProps } from './useShapeNodeProps';

export const StepShape: React.FC<BaseShapeProps> = React.memo((props) => {
  const { shape } = props;
  const shapeNodeProps = useShapeNodeProps(props);
  const radius = shape.radius ?? 15;
  const fontSize = Math.round(radius * 0.93);
  const textOffset = fontSize * 0.3;

  return (
    <Group
      {...shapeNodeProps}
      x={shape.x}
      y={shape.y}
    >
      <Circle radius={radius} fill={shape.fill} />
      <Text
        text={String(shape.number)}
        fontSize={fontSize}
        fill="white"
        fontStyle="bold"
        align="center"
        verticalAlign="middle"
        offsetX={textOffset}
        offsetY={fontSize * 0.43}
      />
    </Group>
  );
});

StepShape.displayName = 'StepShape';
