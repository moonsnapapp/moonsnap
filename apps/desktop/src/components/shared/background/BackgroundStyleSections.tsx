import { Slider } from '@/components/ui/slider';
import { ColorPicker } from '@/components/ui/color-picker';
import { GRADIENT_PRESETS } from '@/constants/wallpapers';

export type GradientPreset = (typeof GRADIENT_PRESETS)[0];

interface GradientSectionProps {
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  onGradientStartChange: (color: string) => void;
  onGradientEndChange: (color: string) => void;
  onGradientAngleChange: (angle: number) => void;
  onPresetSelect: (preset: GradientPreset) => void;
  inactivePresetBorderClass?: string;
}

export function GradientSection({
  gradientStart,
  gradientEnd,
  gradientAngle,
  onGradientStartChange,
  onGradientEndChange,
  onGradientAngleChange,
  onPresetSelect,
  inactivePresetBorderClass = 'border-[var(--glass-border)]',
}: GradientSectionProps) {
  return (
    <div className="space-y-3">
      <div
        className="h-8 rounded-lg border border-[var(--glass-border)]"
        style={{
          background: `linear-gradient(${gradientAngle}deg, ${gradientStart}, ${gradientEnd})`,
        }}
      />

      <div>
        <span className="text-[11px] text-[var(--ink-subtle)] block mb-1.5">Start Color</span>
        <ColorPicker
          value={gradientStart}
          onChange={onGradientStartChange}
          showInput={false}
        />
      </div>

      <div>
        <span className="text-[11px] text-[var(--ink-subtle)] block mb-1.5">End Color</span>
        <ColorPicker
          value={gradientEnd}
          onChange={onGradientEndChange}
          showInput={false}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--ink-subtle)]">Angle</span>
        <Slider
          value={[gradientAngle]}
          onValueChange={([value]) => onGradientAngleChange(value)}
          min={0}
          max={360}
          step={5}
          className="flex-1"
        />
        <span className="text-[11px] text-[var(--ink-faint)] w-10 text-right">
          {gradientAngle}&deg;
        </span>
      </div>

      <div>
        <span className="text-[11px] text-[var(--ink-subtle)] block mb-1.5">Presets</span>
        <div className="grid grid-cols-4 gap-1.5">
          {GRADIENT_PRESETS.map((preset, idx) => {
            const isSelected =
              gradientStart === preset.start && gradientEnd === preset.end;

            return (
              <button
                key={idx}
                onClick={() => onPresetSelect(preset)}
                className={`aspect-square rounded-md border-2 transition-all hover:scale-105 ${
                  isSelected ? 'border-[var(--ink-dark)]' : inactivePresetBorderClass
                }`}
                style={{
                  background: `linear-gradient(${preset.angle}deg, ${preset.start}, ${preset.end})`,
                }}
                title={preset.name}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface PaddingSectionProps {
  value: number;
  onChange: (value: number) => void;
}

export function PaddingSection({ value, onChange }: PaddingSectionProps) {
  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Padding</span>
        <span className="text-xs text-[var(--ink-dark)] font-mono">{value}px</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([next]) => onChange(next)}
        min={0}
        max={200}
        step={4}
      />
    </div>
  );
}

export type CornerKind = 'squircle' | 'rounded';

interface CornerRadiusSectionProps {
  value: number;
  kind: CornerKind;
  onValueChange: (value: number) => void;
  onKindChange: (kind: CornerKind) => void;
}

export function CornerRadiusSection({
  value,
  kind,
  onValueChange,
  onKindChange,
}: CornerRadiusSectionProps) {
  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Corner Radius</span>
        <span className="text-xs text-[var(--ink-dark)] font-mono">{value}px</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([next]) => onValueChange(next)}
        min={0}
        max={100}
        step={2}
      />
      <div className="flex gap-1 mt-2">
        <button
          onClick={() => onKindChange('squircle')}
          className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
            kind === 'squircle'
              ? 'bg-[var(--coral-100)] text-[var(--coral-500)] border border-[var(--coral-300)]'
              : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] border border-[var(--glass-border)] hover:bg-[var(--polar-frost)]'
          }`}
        >
          Squircle
        </button>
        <button
          onClick={() => onKindChange('rounded')}
          className={`flex-1 px-2 py-1.5 text-xs rounded-md transition-colors ${
            kind === 'rounded'
              ? 'bg-[var(--coral-100)] text-[var(--coral-500)] border border-[var(--coral-300)]'
              : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] border border-[var(--glass-border)] hover:bg-[var(--polar-frost)]'
          }`}
        >
          Rounded
        </button>
      </div>
    </div>
  );
}
