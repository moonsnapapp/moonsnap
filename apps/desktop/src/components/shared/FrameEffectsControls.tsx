import { Slider } from '@/components/ui/slider';
import { ColorPicker } from '@/components/ui/color-picker';

interface ToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

export function ToggleSwitch({ enabled, onToggle }: ToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        enabled ? 'bg-[var(--accent-400)]' : 'bg-[var(--polar-frost)]'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          enabled ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

interface ToggleShadowEffectsSectionProps {
  enabled: boolean;
  value: number;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

interface ValueShadowEffectsSectionProps {
  enabled: boolean;
  value: number;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

function ShadowDetails({
  value,
  valueLabel,
  showValue,
  indented,
  onValueChange,
}: {
  value: number;
  valueLabel: string;
  showValue: boolean;
  indented: boolean;
  onValueChange: (value: number) => void;
}) {
  return (
    <div className={indented ? 'space-y-3 pl-3 border-l border-[var(--glass-border)]' : ''}>
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-[var(--ink-subtle)]">{valueLabel}</span>
          {showValue && (
            <span className="text-[11px] text-[var(--ink-faint)]">
              {Math.round(value)}%
            </span>
          )}
        </div>
        <Slider
          value={[value]}
          onValueChange={([nextValue]) => onValueChange(nextValue)}
          min={0}
          max={100}
          step={1}
        />
      </div>
    </div>
  );
}

export function ToggleShadowEffectsSection(props: ToggleShadowEffectsSectionProps) {
  const valueLabel = props.valueLabel ?? 'Shadow';
  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Shadow</span>
        <ToggleSwitch
          enabled={props.enabled}
          onToggle={() => props.onEnabledChange(!props.enabled)}
        />
      </div>

      {props.enabled && (
        <ShadowDetails
          value={props.value}
          valueLabel={valueLabel}
          showValue={true}
          indented={true}
          onValueChange={props.onValueChange}
        />
      )}
    </div>
  );
}

export function ValueShadowEffectsSection(props: ValueShadowEffectsSectionProps) {
  const valueLabel = props.valueLabel ?? 'Shadow';

  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Shadow</span>
        <span className="text-xs text-[var(--ink-dark)] font-mono">
          {Math.round(props.value)}%
        </span>
      </div>

      <ShadowDetails
        value={props.value}
        valueLabel={valueLabel}
        showValue={false}
        indented={false}
        onValueChange={props.onValueChange}
      />
    </div>
  );
}

interface ToggleBorderEffectsSectionProps {
  enabled: boolean;
  width: number;
  color: string;
  opacity: number;
  onEnabledChange: (enabled: boolean) => void;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

interface OpacityBorderEffectsSectionProps {
  enabled: boolean;
  width: number;
  color: string;
  opacity: number;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

function BorderDetails({
  width,
  color,
  opacity,
  onWidthChange,
  onColorChange,
  onOpacityChange,
  showOpacity,
}: {
  width: number;
  color: string;
  opacity: number;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
  showOpacity: boolean;
}) {
  return (
    <div className="space-y-3 pl-3 border-l border-[var(--glass-border)]">
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-[var(--ink-subtle)]">Width</span>
          <span className="text-[11px] text-[var(--ink-faint)]">{width}px</span>
        </div>
        <Slider
          value={[width]}
          onValueChange={([value]) => onWidthChange(value)}
          min={5}
          max={20}
          step={1}
        />
      </div>
      <div>
        <span className="text-[11px] text-[var(--ink-subtle)] block mb-1.5">Color</span>
        <ColorPicker value={color} onChange={onColorChange} showInput={false} />
      </div>
      {showOpacity && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-[var(--ink-subtle)]">Opacity</span>
            <span className="text-[11px] text-[var(--ink-faint)]">{Math.round(opacity)}%</span>
          </div>
          <Slider
            value={[opacity]}
            onValueChange={([value]) => onOpacityChange(value)}
            min={0}
            max={100}
            step={1}
          />
        </div>
      )}
    </div>
  );
}

export function ToggleBorderEffectsSection(props: ToggleBorderEffectsSectionProps) {
  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Border</span>
        <ToggleSwitch
          enabled={props.enabled}
          onToggle={() => props.onEnabledChange(!props.enabled)}
        />
      </div>

      {props.enabled && (
        <BorderDetails
          width={props.width}
          color={props.color}
          opacity={props.opacity}
          onWidthChange={props.onWidthChange}
          onColorChange={props.onColorChange}
          onOpacityChange={props.onOpacityChange}
          showOpacity={true}
        />
      )}
    </div>
  );
}

export function OpacityBorderEffectsSection(props: OpacityBorderEffectsSectionProps) {
  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Border</span>
        <span className="text-xs text-[var(--ink-dark)] font-mono">
          {Math.round(props.opacity)}%
        </span>
      </div>
      <Slider
        value={[props.opacity]}
        onValueChange={([value]) => props.onOpacityChange(value)}
        min={0}
        max={100}
        step={1}
      />

      {props.enabled && (
        <div className="mt-3">
          <BorderDetails
            width={props.width}
            color={props.color}
            opacity={props.opacity}
            onWidthChange={props.onWidthChange}
            onColorChange={props.onColorChange}
            onOpacityChange={props.onOpacityChange}
            showOpacity={false}
          />
        </div>
      )}
    </div>
  );
}
