import * as React from 'react';
import Wheel from '@uiw/react-color-wheel';
import Alpha from '@uiw/react-color-alpha';
import { hsvaToHex, hexToHsva, hsvaToRgbaString, rgbaStringToHsva } from '@uiw/color-convert';
import { X } from 'lucide-react';
import { cn } from './utils';

interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  presets?: string[];
  className?: string;
  showInput?: boolean;
  showTransparent?: boolean;
}

const DEFAULT_PRESETS = [
  '#EF4444', '#F97316', '#F97066', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#FFFFFF', '#1A1A1A',
];
const TRANSPARENT_SWATCH_BACKGROUND =
  'repeating-conic-gradient(#d4d4d4 0% 25%, transparent 0% 50%) 50% / 8px 8px';
const CHECKERED_PREVIEW_BACKGROUND =
  'repeating-conic-gradient(#d4d4d4 0% 25%, white 0% 50%) 50% / 8px 8px';
const DEFAULT_HSVA_COLOR = { h: 0, s: 100, v: 100, a: 1 };
const TRANSPARENT_HSVA_COLOR = { h: 0, s: 0, v: 100, a: 0 };

function isRgbColorString(color: string) {
  return color.startsWith('rgba') || color.startsWith('rgb');
}

function parseColorToHsva(color: string): HsvaColor {
  if (!color) return DEFAULT_HSVA_COLOR;
  if (color === 'transparent') return TRANSPARENT_HSVA_COLOR;
  return isRgbColorString(color) ? rgbaStringToHsva(color) : hexToHsva(color);
}

const safeColorToHsva = (color: string): HsvaColor => {
  try {
    return parseColorToHsva(color);
  } catch {
    return DEFAULT_HSVA_COLOR;
  }
};

// Check if color is fully transparent
const isTransparent = (color: string): boolean => {
  if (color === 'transparent') return true;
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/);
    return match ? parseFloat(match[1]) === 0 : false;
  }
  return false;
};

function hsvaToDisplayColor(color: HsvaColor) {
  return color.a < 1 ? hsvaToRgbaString(color) : hsvaToHex(color);
}

function useColorPickerState(value: string, onChange: (color: string) => void) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [isDragging, setIsDragging] = React.useState(false);
  const committedHsva = React.useMemo(() => safeColorToHsva(value), [value]);
  const [localHsva, setLocalHsva] = React.useState<HsvaColor>(committedHsva);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const wheelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isDragging) {
      setLocalHsva(committedHsva);
    }
  }, [committedHsva, isDragging]);

  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  React.useEffect(() => {
    const handlePointerUp = () => {
      if (isDragging) {
        setIsDragging(false);
        onChange(hsvaToDisplayColor(localHsva));
      }
    };

    if (isDragging) {
      document.addEventListener('pointerup', handlePointerUp);
      document.addEventListener('pointercancel', handlePointerUp);
      return () => {
        document.removeEventListener('pointerup', handlePointerUp);
        document.removeEventListener('pointercancel', handlePointerUp);
      };
    }
  }, [isDragging, localHsva, onChange]);

  const handleWheelChange = React.useCallback((color: { hsva: HsvaColor }) => {
    setLocalHsva(color.hsva);
    if (!isDragging) {
      setIsDragging(true);
    }
  }, [isDragging]);

  const handleAlphaChange = React.useCallback((newAlpha: { a: number }) => {
    setLocalHsva(prev => ({ ...prev, ...newAlpha }));
    if (!isDragging) {
      setIsDragging(true);
    }
  }, [isDragging]);

  const displayHsva = isDragging ? localHsva : committedHsva;
  const displayColor = hsvaToDisplayColor(displayHsva);

  return {
    containerRef,
    wheelRef,
    isOpen,
    setIsOpen,
    isDragging,
    displayHsva,
    displayColor,
    handleWheelChange,
    handleAlphaChange,
  };
}

function PresetColorButtons({
  value,
  presets,
  showTransparent,
  onChange,
}: {
  value: string;
  presets: string[];
  showTransparent: boolean;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {showTransparent && (
        <button
          type="button"
          onClick={() => onChange('rgba(0, 0, 0, 0)')}
          className={cn(
            'w-7 h-7 rounded-lg border-2 transition-all hover:scale-110 flex items-center justify-center',
            isTransparent(value) ? 'border-[var(--ink-black)]' : 'border-[var(--polar-frost)]'
          )}
          style={{ background: TRANSPARENT_SWATCH_BACKGROUND }}
          title="No fill"
        >
          <X className="w-3 h-3 text-[var(--ink-muted)]" />
        </button>
      )}
      {presets.map((color) => (
        <button
          key={color}
          type="button"
          onClick={() => onChange(color)}
          className={cn(
            'w-7 h-7 rounded-lg border-2 transition-all hover:scale-110',
            value === color ? 'border-[var(--ink-black)] shadow-md' : 'border-[var(--glass-border)]'
          )}
          style={{ backgroundColor: color }}
        />
      ))}
    </div>
  );
}

function getColorPreviewBackground(value: string, displayColor: string) {
  return isTransparent(value) ? TRANSPARENT_SWATCH_BACKGROUND : displayColor;
}

function ColorPreviewButton({
  value,
  displayColor,
  isOpen,
  onToggleOpen,
}: {
  value: string;
  displayColor: string;
  isOpen: boolean;
  onToggleOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggleOpen}
      className={cn(
        'w-10 h-10 rounded-lg border-2 transition-all cursor-pointer flex-shrink-0',
        isOpen ? 'border-[var(--accent-400)] ring-2 ring-[var(--accent-glow)]' : 'border-[var(--polar-frost)]'
      )}
      style={{
        background: getColorPreviewBackground(value, displayColor),
      }}
    />
  );
}

function ColorTextInput({
  value,
  displayColor,
  isDragging,
  showInput,
  onChange,
}: {
  value: string;
  displayColor: string;
  isDragging: boolean;
  showInput: boolean;
  onChange: (color: string) => void;
}) {
  if (!showInput) {
    return null;
  }

  return (
    <input
      type="text"
      value={isDragging ? displayColor : value}
      onChange={(e) => onChange(e.target.value)}
      className="flex-1 h-10 px-3 rounded-lg bg-[var(--card)] border border-[var(--polar-frost)] text-sm text-[var(--ink-black)] font-mono focus:ring-[var(--accent-400)] focus:ring-2 focus:ring-[var(--accent-glow)] focus:outline-none"
      placeholder="#000000"
    />
  );
}

function ColorInputRow({
  value,
  displayColor,
  isDragging,
  isOpen,
  showInput,
  onToggleOpen,
  onChange,
}: {
  value: string;
  displayColor: string;
  isDragging: boolean;
  isOpen: boolean;
  showInput: boolean;
  onToggleOpen: () => void;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <ColorPreviewButton
        value={value}
        displayColor={displayColor}
        isOpen={isOpen}
        onToggleOpen={onToggleOpen}
      />
      <ColorTextInput
        value={value}
        displayColor={displayColor}
        isDragging={isDragging}
        showInput={showInput}
        onChange={onChange}
      />
    </div>
  );
}

function ColorWheelPopover({
  wheelRef,
  displayHsva,
  displayColor,
  onWheelChange,
  onAlphaChange,
}: {
  wheelRef: React.RefObject<HTMLDivElement | null>;
  displayHsva: HsvaColor;
  displayColor: string;
  onWheelChange: (color: { hsva: HsvaColor }) => void;
  onAlphaChange: (color: { a: number }) => void;
}) {
  return (
    <div
      ref={wheelRef}
      className="absolute z-50 mt-2 p-4 bg-[var(--card)] rounded-xl border border-[var(--polar-frost)] shadow-xl"
    >
      <Wheel
        color={displayHsva}
        onChange={onWheelChange}
        width={180}
        height={180}
      />
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--ink-muted)]">Opacity</span>
          <span className="text-xs font-mono text-[var(--ink-muted)]">
            {Math.round(displayHsva.a * 100)}%
          </span>
        </div>
        <Alpha
          hsva={displayHsva}
          onChange={onAlphaChange}
          width={180}
          height={12}
          radius={6}
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <div
          className="flex-1 h-6 rounded-md border border-[var(--polar-frost)]"
          style={{
            background: displayHsva.a < 1
              ? `linear-gradient(${displayColor}, ${displayColor}), ${CHECKERED_PREVIEW_BACKGROUND}`
              : displayColor,
          }}
        />
        <span className="text-xs font-mono text-[var(--ink-muted)] w-20 text-right truncate">
          {displayColor.length > 7 ? 'rgba(...)' : displayColor.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  className,
  showInput = true,
  showTransparent = false,
}) => {
  const {
    containerRef,
    wheelRef,
    isOpen,
    setIsOpen,
    isDragging,
    displayHsva,
    displayColor,
    handleWheelChange,
    handleAlphaChange,
  } = useColorPickerState(value, onChange);

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <PresetColorButtons
        value={value}
        presets={presets}
        showTransparent={showTransparent}
        onChange={onChange}
      />

      <ColorInputRow
        value={value}
        displayColor={displayColor}
        isDragging={isDragging}
        isOpen={isOpen}
        showInput={showInput}
        onToggleOpen={() => setIsOpen(!isOpen)}
        onChange={onChange}
      />

      {isOpen && (
        <ColorWheelPopover
          wheelRef={wheelRef}
          displayHsva={displayHsva}
          displayColor={displayColor}
          onWheelChange={handleWheelChange}
          onAlphaChange={handleAlphaChange}
        />
      )}
    </div>
  );
};

export default ColorPicker;
