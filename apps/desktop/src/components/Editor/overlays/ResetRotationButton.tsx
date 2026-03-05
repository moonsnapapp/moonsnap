import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Group, Circle, Line } from 'react-konva';
import Konva from 'konva';

interface ResetRotationButtonProps {
  transformerRef: React.RefObject<Konva.Transformer | null>;
  zoom: number;
  onReset: () => void;
}

interface ButtonPos { x: number; y: number }

/**
 * Small X button above the Transformer's rotation handle.
 * Tracks position synchronously on every Konva event
 * (React 18 batches the state updates automatically).
 */
export const ResetRotationButton: React.FC<ResetRotationButtonProps> = ({
  transformerRef,
  zoom,
  onReset,
}) => {
  const [pos, setPos] = useState<ButtonPos | null>(null);
  const [visible, setVisible] = useState(false);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useEffect(() => {
    const tr = transformerRef.current;
    if (!tr) return;

    const update = () => {
      const nodes = tr.nodes();
      if (nodes.length === 0) { setVisible(false); return; }

      const anyRotated = nodes.some(n => Math.abs(n.rotation()) > 0.1);
      if (!anyRotated) { setVisible(false); return; }

      const z = zoomRef.current;
      const trWidth = tr.width();
      const trHeight = tr.height();
      const offset = tr.rotateAnchorOffset();
      const sign = trHeight >= 0 ? 1 : -1;
      const gap = 16 / z;

      const localX = trWidth / 2;
      const localY = -offset * sign - gap * sign;

      const absP = tr.getAbsoluteTransform().point({ x: localX, y: localY });
      const stage = tr.getStage();
      if (!stage) { setVisible(false); return; }

      const canvasP = stage.getAbsoluteTransform().copy().invert().point(absP);
      setPos(canvasP);
      setVisible(true);
    };

    tr.on('transform dragmove', update);
    const layer = tr.getLayer();
    layer?.on('draw', update);
    // Also listen to dragmove on individual nodes (transformer's
    // own dragmove doesn't fire when a child node is dragged)
    const nodes = tr.nodes();
    nodes.forEach(n => n.on('dragmove.resetBtn', update));
    update();

    return () => {
      tr.off('transform dragmove', update);
      layer?.off('draw', update);
      nodes.forEach(n => n.off('dragmove.resetBtn'));
    };
  }, [transformerRef]);

  const handleClick = useCallback((e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onReset();
  }, [onReset]);

  if (!visible || !pos) return null;

  const btnRadius = 7 / zoom;
  const strokeWidth = 1 / zoom;
  const xSize = 3 / zoom;
  const xStroke = 1.5 / zoom;

  return (
    <Group
      x={pos.x}
      y={pos.y}
      name="editor-gizmo"
      listening={true}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'pointer';
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container();
        if (container) container.style.cursor = 'default';
      }}
      onClick={handleClick}
      onTap={handleClick}
    >
      <Circle
        radius={btnRadius}
        fill="#ffffff"
        stroke="#9CA3AF"
        strokeWidth={strokeWidth}
      />
      <Line
        points={[-xSize, -xSize, xSize, xSize]}
        stroke="#6B7280"
        strokeWidth={xStroke}
        lineCap="round"
      />
      <Line
        points={[xSize, -xSize, -xSize, xSize]}
        stroke="#6B7280"
        strokeWidth={xStroke}
        lineCap="round"
      />
    </Group>
  );
};

ResetRotationButton.displayName = 'ResetRotationButton';
