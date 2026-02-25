import { Slider } from '@/components/ui/slider';
import { ColorPicker } from '@/components/ui/color-picker';

type ToggleMode = 'toggle';
type ValueMode = 'value';

interface ToggleButtonProps {
  enabled: boolean;
  onToggle: () => void;
}

export function ToggleSwitch({ enabled, onToggle }: ToggleButtonProps) {
  return (
    <button
      onClick={onToggle}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        enabled ? 'bg-[var(--coral-400)]' : 'bg-[var(--polar-frost)]'
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

interface ShadowEffectsSectionToggleProps {
  mode: ToggleMode;
  enabled: boolean;
  value: number;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

interface ShadowEffectsSectionValueProps {
  mode: ValueMode;
  enabled: boolean;
  value: number;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

export type ShadowEffectsSectionProps =
  | ShadowEffectsSectionToggleProps
  | ShadowEffectsSectionValueProps;

export function ShadowEffectsSection(props: ShadowEffectsSectionProps) {
  const valueLabel = props.valueLabel ?? 'Shadow';
  const showDetails = props.mode === 'toggle' ? props.enabled : true;

  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--ink-muted)]">Shadow</span>
        {props.mode === 'toggle' ? (
          <ToggleSwitch
            enabled={props.enabled}
            onToggle={() => props.onEnabledChange(!props.enabled)}
          />
        ) : (
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {Math.round(props.value)}%
          </span>
        )}
      </div>

      {showDetails && (
        <div
          className={
            props.mode === 'toggle'
              ? 'space-y-3 pl-3 border-l border-[var(--glass-border)]'
              : ''
          }
        >
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-[var(--ink-subtle)]">{valueLabel}</span>
              {props.mode === 'toggle' && (
                <span className="text-[11px] text-[var(--ink-faint)]">
                  {Math.round(props.value)}%
                </span>
              )}
            </div>
            <Slider
              value={[props.value]}
              onValueChange={([value]) => props.onValueChange(value)}
              min={0}
              max={100}
              step={1}
            />
          </div>
        </div>
      )}
    </div>
  );
}

type BorderOpacityMode = 'opacity';

interface BorderEffectsSectionToggleProps {
  mode: ToggleMode;
  enabled: boolean;
  width: number;
  color: string;
  opacity: number;
  onEnabledChange: (enabled: boolean) => void;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

interface BorderEffectsSectionOpacityProps {
  mode: BorderOpacityMode;
  enabled: boolean;
  width: number;
  color: string;
  opacity: number;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

export type BorderEffectsSectionProps =
  | BorderEffectsSectionToggleProps
  | BorderEffectsSectionOpacityProps;

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
          min={1}
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

export function BorderEffectsSection(props: BorderEffectsSectionProps) {
  if (props.mode === 'toggle') {
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
