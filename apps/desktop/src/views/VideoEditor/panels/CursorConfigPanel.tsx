/**
 * CursorConfigPanel - Cursor visibility, size, motion blur, click highlight settings.
 */
import { CURSOR } from '../../../constants';
import { Slider } from '../../../components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '../../../components/ui/toggle-group';
import type { VideoProject, CursorConfig } from '../../../types';

export interface CursorConfigPanelProps {
  project: VideoProject;
  onUpdateCursorConfig: (updates: Partial<CursorConfig>) => void;
}

export function CursorConfigPanel({ project, onUpdateCursorConfig }: CursorConfigPanelProps) {
  const hideWhenIdle = project.cursor.hideWhenIdle ?? true;
  const dampening = project.cursor.dampening ?? CURSOR.DAMPENING_DEFAULT;

  return (
    <div className="space-y-4">
      {/* Show/Hide Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Show Cursor</span>
        <button
          onClick={() => onUpdateCursorConfig({ visible: !project.cursor.visible })}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            project.cursor.visible ? 'bg-[var(--coral-400)]' : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              project.cursor.visible ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Cursor Type */}
      <div>
        <span className="text-[11px] text-[var(--ink-subtle)] block mb-2">Cursor Type</span>
        <ToggleGroup
          type="single"
          value={project.cursor.cursorType}
          onValueChange={(value) => {
            if (value) onUpdateCursorConfig({ cursorType: value as 'auto' | 'circle' });
          }}
          className="justify-start"
        >
          <ToggleGroupItem value="auto" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
            Auto
          </ToggleGroupItem>
          <ToggleGroupItem value="circle" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
            Circle
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Size Slider */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Size</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {Math.round(project.cursor.scale * 100)}%
          </span>
        </div>
        <Slider
          value={[project.cursor.scale * 100]}
          onValueChange={(values) => onUpdateCursorConfig({ scale: values[0] / 100 })}
          min={50}
          max={300}
          step={10}
        />
      </div>

      {/* Dampening */}
      <div>
        <div className="flex items-start justify-between mb-2">
          <div className="flex flex-col">
            <span className="text-xs text-[var(--ink-muted)]">Dampening</span>
            <span className="text-[10px] text-[var(--ink-subtle)]">Adapts cursor smoothing as zoom increases</span>
          </div>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {Math.round(dampening * 100)}%
          </span>
        </div>
        <Slider
          value={[dampening * 100]}
          onValueChange={(values) => onUpdateCursorConfig({ dampening: values[0] / 100 })}
          min={CURSOR.DAMPENING_MIN * 100}
          max={CURSOR.DAMPENING_MAX * 100}
          step={5}
        />
        <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--ink-subtle)]">
          <span>Linear</span>
          <span>Smooth</span>
        </div>
      </div>

      {/* Motion Blur */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Motion Blur</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {Math.round(project.cursor.motionBlur * 100)}%
          </span>
        </div>
        <Slider
          value={[project.cursor.motionBlur * 100]}
          onValueChange={(values) => onUpdateCursorConfig({ motionBlur: values[0] / 100 })}
          min={0}
          max={15}
          step={1}
        />
      </div>

      {/* Idle Fade Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-xs text-[var(--ink-muted)]">Hide When Idle</span>
          <span className="text-[10px] text-[var(--ink-subtle)]">Fade cursor after inactivity</span>
        </div>
        <button
          onClick={() => onUpdateCursorConfig({ hideWhenIdle: !hideWhenIdle })}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            hideWhenIdle ? 'bg-[var(--coral-400)]' : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              hideWhenIdle ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Click Highlight Section */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[var(--ink-muted)]">Click Highlight</span>
          <button
            onClick={() => onUpdateCursorConfig({
              clickHighlight: { ...project.cursor.clickHighlight, enabled: !project.cursor.clickHighlight.enabled }
            })}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              project.cursor.clickHighlight.enabled ? 'bg-[var(--coral-400)]' : 'bg-[var(--polar-frost)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                project.cursor.clickHighlight.enabled ? 'translate-x-5' : 'translate-x-0'
              }`}
            />
          </button>
        </div>

        {project.cursor.clickHighlight.enabled && (
          <div className="space-y-3">
            {/* Highlight Style */}
            <div>
              <span className="text-[11px] text-[var(--ink-subtle)] block mb-2">Style</span>
              <ToggleGroup
                type="single"
                value={project.cursor.clickHighlight.style}
                onValueChange={(value) => {
                  if (value) onUpdateCursorConfig({
                    clickHighlight: { ...project.cursor.clickHighlight, style: value as 'ripple' | 'spotlight' | 'ring' }
                  });
                }}
                className="justify-start"
              >
                <ToggleGroupItem value="ripple" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                  Ripple
                </ToggleGroupItem>
                <ToggleGroupItem value="spotlight" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                  Spotlight
                </ToggleGroupItem>
                <ToggleGroupItem value="ring" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                  Ring
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            {/* Highlight Color */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--ink-subtle)]">Color</span>
              <input
                type="color"
                value={project.cursor.clickHighlight.color}
                onChange={(e) => onUpdateCursorConfig({
                  clickHighlight: { ...project.cursor.clickHighlight, color: e.target.value }
                })}
                className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
              />
            </div>

            {/* Highlight Radius */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[var(--ink-subtle)]">Radius</span>
                <span className="text-[11px] text-[var(--ink-muted)] font-mono">{project.cursor.clickHighlight.radius}px</span>
              </div>
              <Slider
                value={[project.cursor.clickHighlight.radius]}
                onValueChange={(values) => onUpdateCursorConfig({
                  clickHighlight: { ...project.cursor.clickHighlight, radius: values[0] }
                })}
                min={10}
                max={100}
                step={5}
              />
            </div>

            {/* Highlight Duration */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-[var(--ink-subtle)]">Duration</span>
                <span className="text-[11px] text-[var(--ink-muted)] font-mono">{project.cursor.clickHighlight.durationMs}ms</span>
              </div>
              <Slider
                value={[project.cursor.clickHighlight.durationMs]}
                onValueChange={(values) => onUpdateCursorConfig({
                  clickHighlight: { ...project.cursor.clickHighlight, durationMs: values[0] }
                })}
                min={100}
                max={1000}
                step={50}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
