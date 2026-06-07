/**
 * Position grid for 9-point webcam anchor selection.
 * Maps to corner presets or custom positions for edges/center.
 */
import type { WebcamOverlayPosition } from '../../types';

export interface PositionGridProps {
  position: WebcamOverlayPosition;
  customX: number;
  customY: number;
  onChange: (position: WebcamOverlayPosition, customX: number, customY: number) => void;
}

// Grid positions: [row][col] -> { position, customX, customY }
const GRID_POSITIONS: Array<{
  position: WebcamOverlayPosition;
  customX: number;
  customY: number;
  label: string;
}> = [
  // Top row
  { position: 'topLeft', customX: 0, customY: 0, label: 'Top Left' },
  { position: 'custom', customX: 0.5, customY: 0.02, label: 'Top Center' },
  { position: 'topRight', customX: 1, customY: 0, label: 'Top Right' },
  // Middle row
  { position: 'custom', customX: 0.02, customY: 0.5, label: 'Middle Left' },
  { position: 'custom', customX: 0.5, customY: 0.5, label: 'Center' },
  { position: 'custom', customX: 0.98, customY: 0.5, label: 'Middle Right' },
  // Bottom row
  { position: 'bottomLeft', customX: 0, customY: 1, label: 'Bottom Left' },
  { position: 'custom', customX: 0.5, customY: 0.98, label: 'Bottom Center' },
  { position: 'bottomRight', customX: 1, customY: 1, label: 'Bottom Right' },
];

const PRESET_ACTIVE_INDEX: Partial<Record<WebcamOverlayPosition, number>> = {
  topLeft: 0,
  topRight: 2,
  bottomLeft: 6,
  bottomRight: 8,
};

const CUSTOM_ACTIVE_ZONES: Array<{
  index: number;
  matches: (customX: number, customY: number) => boolean;
}> = [
  { index: 1, matches: (customX, customY) => customY < 0.25 && customX > 0.25 && customX < 0.75 },
  { index: 3, matches: (customX, customY) => customX < 0.25 && customY > 0.25 && customY < 0.75 },
  { index: 4, matches: (customX, customY) => customX > 0.25 && customX < 0.75 && customY > 0.25 && customY < 0.75 },
  { index: 5, matches: (customX, customY) => customX > 0.75 && customY > 0.25 && customY < 0.75 },
  { index: 7, matches: (customX, customY) => customY > 0.75 && customX > 0.25 && customX < 0.75 },
];

function getPresetActiveIndex(position: WebcamOverlayPosition) {
  return PRESET_ACTIVE_INDEX[position] ?? null;
}

function getCustomActiveIndex(
  position: WebcamOverlayPosition,
  customX: number,
  customY: number,
) {
  if (position !== 'custom') {
    return -1;
  }

  return CUSTOM_ACTIVE_ZONES.find((zone) => zone.matches(customX, customY))?.index ?? -1;
}

function getActivePositionIndex(
  position: WebcamOverlayPosition,
  customX: number,
  customY: number
) {
  const presetIndex = getPresetActiveIndex(position);
  if (presetIndex !== null) {
    return presetIndex;
  }

  return getCustomActiveIndex(position, customX, customY);
}

export function PositionGrid({ position, customX, customY, onChange }: PositionGridProps) {
  const activeIndex = getActivePositionIndex(position, customX, customY);

  return (
    <div className="w-full p-3 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-surface-dark)] flex flex-col gap-2">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex justify-between">
          {[0, 1, 2].map((col) => {
            const index = row * 3 + col;
            const pos = GRID_POSITIONS[index];
            return (
              <button
                key={index}
                type="button"
                title={pos.label}
                onClick={() => onChange(pos.position, pos.customX, pos.customY)}
                className={`w-6 h-6 rounded transition-colors ${
                  activeIndex === index
                    ? 'bg-[var(--accent-400)]'
                    : 'bg-[var(--polar-frost)] hover:bg-[var(--polar-steel)]'
                }`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
