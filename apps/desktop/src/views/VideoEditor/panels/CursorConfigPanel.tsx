/**
 * CursorConfigPanel - Cursor visibility, size, motion blur, click highlight settings.
 */
import { CURSOR } from '../../../constants';
import { Slider } from '../../../components/ui/slider';
import type { VideoProject, CursorConfig } from '../../../types';

export interface CursorConfigPanelProps {
  project: VideoProject;
  onUpdateCursorConfig: (updates: Partial<CursorConfig>) => void;
}

function CursorToggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        checked ? 'bg-[var(--accent-400)]' : 'bg-[var(--polar-frost)]'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function CursorToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="text-xs text-[var(--ink-muted)]">{label}</span>
        {description && (
          <span className="text-[10px] text-[var(--ink-subtle)]">{description}</span>
        )}
      </div>
      <CursorToggle checked={checked} onChange={onChange} />
    </div>
  );
}

function CursorChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  capitalize = false,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  capitalize?: boolean;
}) {
  const getOptionLabel = getCursorChoiceLabelFormatter();

  return (
    <div>
      <span className="text-[11px] text-[var(--ink-subtle)] block mb-2">{label}</span>
      <div className="flex gap-1.5">
        {options.map((option) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className={`editor-choice-pill px-2.5 py-1.5 text-xs ${
              capitalize ? 'capitalize' : ''
            } ${value === option ? 'editor-choice-pill--active' : ''}`}
          >
            {getOptionLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function getCursorChoiceLabelFormatter() {
  const labels: Record<string, string> = {
    auto: 'Auto',
    circle: 'Circle',
  };

  return (option: string) => labels[option] ?? option;
}

function CursorSlider({
  label,
  value,
  displayValue,
  min,
  max,
  step,
  onChange,
  description,
  footer,
}: {
  label: string;
  value: number;
  displayValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  description?: string;
  footer?: React.ReactNode;
}) {
  return (
    <div>
      <div className={`flex ${description ? 'items-start' : 'items-center'} justify-between mb-2`}>
        <div className="flex flex-col">
          <span className="text-xs text-[var(--ink-muted)]">{label}</span>
          {description && (
            <span className="text-[10px] text-[var(--ink-subtle)]">{description}</span>
          )}
        </div>
        <span className="text-xs text-[var(--ink-dark)] font-mono">{displayValue}</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={(values) => onChange(values[0])}
        min={min}
        max={max}
        step={step}
      />
      {footer}
    </div>
  );
}

function updateClickHighlight(
  project: VideoProject,
  updates: Partial<NonNullable<CursorConfig['clickHighlight']>>
): Partial<CursorConfig> {
  return {
    clickHighlight: { ...project.cursor.clickHighlight, ...updates },
  };
}

export function CursorConfigPanel({ project, onUpdateCursorConfig }: CursorConfigPanelProps) {
  const hideWhenIdle = project.cursor.hideWhenIdle ?? true;
  const dampening = project.cursor.dampening ?? CURSOR.DAMPENING_DEFAULT;

  return (
    <div className="space-y-4">
      <CursorToggleRow
        label="Show Cursor"
        checked={project.cursor.visible}
        onChange={(visible) => onUpdateCursorConfig({ visible })}
      />

      <CursorChoiceGroup
        label="Cursor Type"
        options={['auto', 'circle'] as const}
        value={project.cursor.cursorType}
        onChange={(cursorType) => onUpdateCursorConfig({ cursorType })}
      />

      <CursorSlider
        label="Size"
        value={project.cursor.scale * 100}
        displayValue={`${Math.round(project.cursor.scale * 100)}%`}
        onChange={(value) => onUpdateCursorConfig({ scale: value / 100 })}
        min={50}
        max={300}
        step={10}
      />

      <CursorSlider
        label="Dampening"
        description="Adapts cursor smoothing as zoom increases"
        value={dampening * 100}
        displayValue={`${Math.round(dampening * 100)}%`}
        onChange={(value) => onUpdateCursorConfig({ dampening: value / 100 })}
        min={CURSOR.DAMPENING_MIN * 100}
        max={CURSOR.DAMPENING_MAX * 100}
        step={5}
        footer={(
          <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--ink-subtle)]">
            <span>Linear</span>
            <span>Smooth</span>
          </div>
        )}
      />

      <CursorSlider
        label="Motion Blur"
        value={project.cursor.motionBlur * 100}
        displayValue={`${Math.round(project.cursor.motionBlur * 100)}%`}
        onChange={(value) => onUpdateCursorConfig({ motionBlur: value / 100 })}
        min={0}
        max={15}
        step={1}
      />

      <CursorToggleRow
        label="Hide When Idle"
        description="Fade cursor after inactivity"
        checked={hideWhenIdle}
        onChange={(nextHideWhenIdle) => onUpdateCursorConfig({ hideWhenIdle: nextHideWhenIdle })}
      />

      {/* Click Highlight Section */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[var(--ink-muted)]">Click Highlight</span>
          <CursorToggle
            checked={project.cursor.clickHighlight.enabled}
            onChange={(enabled) => onUpdateCursorConfig(updateClickHighlight(project, { enabled }))}
          />
        </div>

        {project.cursor.clickHighlight.enabled && (
          <div className="space-y-3">
            <CursorChoiceGroup
              label="Style"
              options={['ripple', 'spotlight', 'ring'] as const}
              value={project.cursor.clickHighlight.style}
              capitalize
              onChange={(style) => onUpdateCursorConfig(updateClickHighlight(project, { style }))}
            />

            {/* Highlight Color */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--ink-subtle)]">Color</span>
              <input
                type="color"
                value={project.cursor.clickHighlight.color}
                onChange={(e) => onUpdateCursorConfig({
                  ...updateClickHighlight(project, { color: e.target.value })
                })}
                className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
              />
            </div>

            <CursorSlider
              label="Radius"
              value={project.cursor.clickHighlight.radius}
              displayValue={`${project.cursor.clickHighlight.radius}px`}
              onChange={(radius) => onUpdateCursorConfig(updateClickHighlight(project, { radius }))}
              min={10}
              max={100}
              step={5}
            />

            <CursorSlider
              label="Duration"
              value={project.cursor.clickHighlight.durationMs}
              displayValue={`${project.cursor.clickHighlight.durationMs}ms`}
              onChange={(durationMs) => onUpdateCursorConfig(updateClickHighlight(project, { durationMs }))}
              min={100}
              max={1000}
              step={50}
            />
          </div>
        )}
      </div>
    </div>
  );
}
