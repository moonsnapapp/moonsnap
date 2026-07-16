import { Slider } from '../../../components/ui/slider';
import type { CaptionSettings } from '../../../types';

export interface CaptionStyleSettingsProps {
  settings: CaptionSettings;
  onUpdateSettings: (updates: Partial<CaptionSettings>) => void;
}
export function CaptionStyleSettings({
  settings,
  onUpdateSettings,
}: CaptionStyleSettingsProps) {
  return (
    <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
      <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide block">
        Style
      </span>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--ink-muted)]">Font Size</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {settings.size}px
          </span>
        </div>
        <Slider
          value={[settings.size]}
          onValueChange={(values) => onUpdateSettings({ size: values[0] })}
          min={16}
          max={64}
          step={2}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Text Color</span>
        <input
          type="color"
          value={settings.color}
          onChange={(event) => onUpdateSettings({ color: event.target.value })}
          className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Highlight Color</span>
        <input
          type="color"
          value={settings.highlightColor}
          onChange={(event) =>
            onUpdateSettings({ highlightColor: event.target.value })
          }
          className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
        />
      </div>

      <div className="space-y-2">
        <span className="text-xs text-[var(--ink-muted)] block">
          Animation Timing
        </span>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">
              Word Transition
            </span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {settings.wordTransitionDuration.toFixed(2)}s
            </span>
          </div>
          <Slider
            value={[Math.round(settings.wordTransitionDuration * 100)]}
            onValueChange={(values) =>
              onUpdateSettings({ wordTransitionDuration: values[0] / 100 })
            }
            min={0}
            max={100}
            step={1}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">Segment Fade</span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {settings.fadeDuration.toFixed(2)}s
            </span>
          </div>
          <Slider
            value={[Math.round(settings.fadeDuration * 100)]}
            onValueChange={(values) =>
              onUpdateSettings({ fadeDuration: values[0] / 100 })
            }
            min={0}
            max={150}
            step={1}
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-[var(--ink-muted)]">
              Linger After Segment
            </span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">
              {settings.lingerDuration.toFixed(2)}s
            </span>
          </div>
          <Slider
            value={[Math.round(settings.lingerDuration * 100)]}
            onValueChange={(values) =>
              onUpdateSettings({ lingerDuration: values[0] / 100 })
            }
            min={0}
            max={300}
            step={1}
          />
        </div>
      </div>

      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">
          Position
        </span>
        <div className="flex gap-1.5">
          <button
            onClick={() => onUpdateSettings({ position: 'top' })}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs ${
              settings.position === 'top' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Top
          </button>
          <button
            onClick={() => onUpdateSettings({ position: 'bottom' })}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs ${
              settings.position === 'bottom' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Bottom
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">
          Background Color
        </span>
        <input
          type="color"
          value={settings.backgroundColor}
          onChange={(event) =>
            onUpdateSettings({ backgroundColor: event.target.value })
          }
          className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-[var(--ink-muted)]">
            Background Opacity
          </span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {settings.backgroundOpacity}%
          </span>
        </div>
        <Slider
          value={[settings.backgroundOpacity]}
          onValueChange={(values) =>
            onUpdateSettings({ backgroundOpacity: values[0] })
          }
          min={0}
          max={100}
          step={5}
        />
      </div>
    </div>
  );
}
