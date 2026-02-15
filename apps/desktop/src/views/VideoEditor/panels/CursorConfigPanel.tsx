/**
 * CursorConfigPanel - Cursor visibility, size, animation, click highlight settings.
 */
import { Slider } from '../../../components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '../../../components/ui/toggle-group';
import type { VideoProject, CursorConfig } from '../../../types';

export interface CursorConfigPanelProps {
  project: VideoProject;
  onUpdateCursorConfig: (updates: Partial<CursorConfig>) => void;
}

export function CursorConfigPanel({ project, onUpdateCursorConfig }: CursorConfigPanelProps) {
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

      {/* Smooth Movement */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Smooth Movement</span>
        <button
          onClick={() => onUpdateCursorConfig({ smoothMovement: !project.cursor.smoothMovement })}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            project.cursor.smoothMovement ? 'bg-[var(--coral-400)]' : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              project.cursor.smoothMovement ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Animation Style (only when smoothMovement is enabled) */}
      {project.cursor.smoothMovement && (
        <div className="pl-3 border-l border-[var(--glass-border)] space-y-3">
          <div>
            <span className="text-[11px] text-[var(--ink-subtle)] block mb-2">Animation Style</span>
            <ToggleGroup
              type="single"
              value={project.cursor.animationStyle}
              onValueChange={(value) => {
                if (value) {
                  const style = value as 'slow' | 'mellow' | 'fast' | 'custom';
                  // Apply preset values when selecting a non-custom style
                  const presets: Record<string, { tension: number; mass: number; friction: number }> = {
                    slow: { tension: 65, mass: 1.8, friction: 16 },
                    mellow: { tension: 120, mass: 1.1, friction: 18 },
                    fast: { tension: 200, mass: 0.8, friction: 20 },
                  };
                  if (style !== 'custom' && presets[style]) {
                    onUpdateCursorConfig({ animationStyle: style, ...presets[style] });
                  } else {
                    onUpdateCursorConfig({ animationStyle: style });
                  }
                }
              }}
              className="justify-start flex-wrap gap-1"
            >
              <ToggleGroupItem value="slow" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                Slow
              </ToggleGroupItem>
              <ToggleGroupItem value="mellow" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                Mellow
              </ToggleGroupItem>
              <ToggleGroupItem value="fast" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                Fast
              </ToggleGroupItem>
              <ToggleGroupItem value="custom" className="text-xs h-7 px-2.5 data-[state=on]:bg-[var(--polar-frost)]">
                Custom
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Physics Controls (only when Custom style is selected) */}
          {project.cursor.animationStyle === 'custom' && (
            <div className="space-y-3 pt-2">
              {/* Tension */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[var(--ink-subtle)]">Tension</span>
                  <span className="text-[11px] text-[var(--ink-muted)] font-mono">{Math.round(project.cursor.tension)}</span>
                </div>
                <Slider
                  value={[project.cursor.tension]}
                  onValueChange={(values) => onUpdateCursorConfig({ tension: values[0] })}
                  min={1}
                  max={500}
                  step={5}
                />
              </div>

              {/* Mass */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[var(--ink-subtle)]">Mass</span>
                  <span className="text-[11px] text-[var(--ink-muted)] font-mono">{project.cursor.mass.toFixed(1)}</span>
                </div>
                <Slider
                  value={[project.cursor.mass * 10]}
                  onValueChange={(values) => onUpdateCursorConfig({ mass: values[0] / 10 })}
                  min={1}
                  max={100}
                  step={1}
                />
              </div>

              {/* Friction */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] text-[var(--ink-subtle)]">Friction</span>
                  <span className="text-[11px] text-[var(--ink-muted)] font-mono">{Math.round(project.cursor.friction)}</span>
                </div>
                <Slider
                  value={[project.cursor.friction]}
                  onValueChange={(values) => onUpdateCursorConfig({ friction: values[0] })}
                  min={0}
                  max={50}
                  step={1}
                />
              </div>
            </div>
          )}
        </div>
      )}

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
