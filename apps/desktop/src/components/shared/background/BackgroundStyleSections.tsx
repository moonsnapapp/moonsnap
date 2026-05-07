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
    <div className="min-w-0 space-y-3">
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

      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[11px] text-[var(--ink-subtle)]">Angle</span>
        <Slider
          value={[gradientAngle]}
          onValueChange={([value]) => onGradientAngleChange(value)}
          min={0}
          max={360}
          step={5}
          className="min-w-0 flex-1"
        />
        <span className="text-[11px] text-[var(--ink-faint)] w-10 text-right">
          {gradientAngle}&deg;
        </span>
      </div>

      <div>
        <span className="text-[11px] text-[var(--ink-subtle)] block mb-1.5">Presets</span>
        <div className="grid min-w-0 grid-cols-4 gap-1.5">
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
    <div className="border-t border-[var(--glass-border)] pt-3">
      <div className="mb-2 flex min-w-0 items-center justify-between">
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
    <div className="border-t border-[var(--glass-border)] pt-3">
      <div className="mb-2 flex min-w-0 items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Corner Radius</span>
        <span className="text-xs text-[var(--ink-dark)] font-mono">{value}px</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([next]) => onValueChange(next)}
        min={0}
        max={200}
        step={2}
      />
      <div className="mt-2 flex min-w-0 gap-1">
        <button
          onClick={() => onKindChange('squircle')}
          className={`editor-choice-pill min-w-0 flex-1 px-2 py-1.5 text-xs ${
            kind === 'squircle' ? 'editor-choice-pill--active' : ''
          }`}
        >
          Squircle
        </button>
        <button
          onClick={() => onKindChange('rounded')}
          className={`editor-choice-pill min-w-0 flex-1 px-2 py-1.5 text-xs ${
            kind === 'rounded' ? 'editor-choice-pill--active' : ''
          }`}
        >
          Rounded
        </button>
      </div>
    </div>
  );
}
