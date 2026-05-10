/**
 * TextSegmentConfig - Configuration panel for text segments.
 * Uses Cap's simplified model: content, center positioning, size, basic font properties.
 */
import { useState, useEffect, useMemo, useCallback, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, ChevronsUpDown, Italic } from 'lucide-react';
import { TEXT_ANIMATION, TEXT_STYLE } from '@/constants';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { videoEditorLogger } from '@/utils/logger';
import { getSystemFonts, getSystemFontsSnapshot } from '@/utils/systemFonts';
import { getTypewriterCharsPerSecond, normalizeTextAnimation } from '@/utils/textSegmentAnimation';
import { cn } from '@/lib/utils';
import { Slider } from '../../components/ui/slider';
import type { TextAnimation, TextSegment } from '../../types';

export interface TextSegmentConfigProps {
  segment: TextSegment;
  onUpdate: (updates: Partial<TextSegment>) => void;
  onDelete: () => void;
  onDone: () => void;
}

// Default font families (fallback if system fonts fail to load)
const DEFAULT_FONT_FAMILIES = [
  'sans-serif',
  'serif',
  'monospace',
];

// Weight labels for display
const WEIGHT_LABELS: Record<number, string> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semibold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

const ANIMATION_OPTIONS: Array<{ value: TextAnimation; label: string }> = [
  { value: 'none', label: 'Default' },
  { value: 'typeWriter', label: 'TypeWriter' },
];

interface ConfigSectionProps {
  title: string;
  children: ReactNode;
}

function ConfigSection({ title, children }: ConfigSectionProps) {
  return (
    <section className="space-y-3 border-t border-[var(--glass-border)] pt-4 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-medium uppercase tracking-wide text-[var(--ink-subtle)]">{title}</h3>
      {children}
    </section>
  );
}

interface ToggleSwitchProps {
  enabled: boolean;
  onToggle: () => void;
}

function ToggleSwitch({ enabled, onToggle }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`relative w-10 h-5 rounded-full transition-colors ${
        enabled
          ? 'bg-[var(--coral-400)]'
          : 'bg-[var(--polar-frost)]'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-5' : ''
      }`} />
    </button>
  );
}

export function TextSegmentConfig({ segment, onUpdate, onDelete, onDone }: TextSegmentConfigProps) {
  const cachedFonts = getSystemFontsSnapshot();
  // System fonts state - start with defaults + current font
  const [systemFonts, setSystemFonts] = useState<string[]>(() => cachedFonts ?? []);
  const [fontComboboxOpen, setFontComboboxOpen] = useState(false);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [hasRequestedFonts, setHasRequestedFonts] = useState(() => cachedFonts !== null);
  // Available font weights for the selected font
  const [availableWeights, setAvailableWeights] = useState<number[]>([400, 700]);
  // Collapse legacy fade variants into a single "Default" mode in the UI.
  const animation = normalizeTextAnimation(segment.animation) === 'typeWriter'
    ? 'typeWriter'
    : 'none';
  const typewriterCharsPerSecond = getTypewriterCharsPerSecond(segment);
  const typewriterSoundEnabled = segment.typewriterSoundEnabled ?? false;
  const backgroundColor = segment.backgroundColor ?? TEXT_STYLE.DEFAULT_BACKGROUND_COLOR;
  const backgroundStrokeColor = segment.backgroundStrokeColor ?? TEXT_STYLE.DEFAULT_BACKGROUND_STROKE_COLOR;
  const backgroundStrokeWidth = segment.backgroundStrokeWidth ?? 0;
  const strokeColor = segment.strokeColor ?? TEXT_STYLE.DEFAULT_STROKE_COLOR;
  const strokeWidth = segment.strokeWidth ?? 0;
  const hasBackground = segment.backgroundColor != null;
  const hasBackgroundStroke = segment.backgroundStrokeColor != null && backgroundStrokeWidth > 0;
  const hasStroke = segment.strokeColor != null && strokeWidth > 0;

  // Ensure current font is always in the list, even before system fonts load
  const fontFamilies = useMemo(() => {
    const fonts = systemFonts.length > 0 ? systemFonts : DEFAULT_FONT_FAMILIES;
    // Add current font if not in list
    if (segment.fontFamily && !fonts.includes(segment.fontFamily)) {
      return [segment.fontFamily, ...fonts];
    }
    return fonts;
  }, [systemFonts, segment.fontFamily]);

  const ensureSystemFontsLoaded = useCallback(() => {
    if (hasRequestedFonts) return;

    setHasRequestedFonts(true);
    setIsLoadingFonts(true);
    getSystemFonts()
      .then((fonts) => {
        if (fonts.length > 0) {
          setSystemFonts(fonts);
        }
      })
      .catch((err) => {
        videoEditorLogger.warn('Failed to load system fonts:', err);
        setHasRequestedFonts(false);
      })
      .finally(() => {
        setIsLoadingFonts(false);
      });
  }, [hasRequestedFonts]);

  // Fetch available weights when font family changes
  useEffect(() => {
    if (!segment.fontFamily || segment.fontFamily === 'sans-serif') {
      // Generic fonts - show common weights
      setAvailableWeights([400, 700]);
      return;
    }

    invoke<number[]>('get_font_weights', { family: segment.fontFamily })
      .then((weights) => {
        if (weights && weights.length > 0) {
          setAvailableWeights(weights);
          // If current weight isn't available, switch to closest available
          if (!weights.includes(segment.fontWeight)) {
            const closest = weights.reduce((prev, curr) =>
              Math.abs(curr - segment.fontWeight) < Math.abs(prev - segment.fontWeight) ? curr : prev
            );
            onUpdate({ fontWeight: closest });
          }
        }
      })
      .catch((err) => {
        videoEditorLogger.warn('Failed to load font weights:', err);
        setAvailableWeights([400, 700]); // Fallback
      });
  }, [onUpdate, segment.fontFamily, segment.fontWeight]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={onDone}
            className="h-7 px-2.5 bg-[var(--coral-100)] hover:bg-[var(--coral-200)] text-[var(--coral-400)] text-xs font-medium rounded-md transition-colors"
          >
            Done
          </button>
          <span className="text-xs text-[var(--ink-subtle)]">Text segment</span>
        </div>
        <button
          onClick={onDelete}
          className="h-7 px-2.5 bg-[var(--error-light)] hover:bg-[rgba(239,68,68,0.2)] text-[var(--error)] text-xs rounded-md transition-colors"
        >
          Delete
        </button>
      </div>

      <ConfigSection title="Text">
        <div>
          <span className="text-xs text-[var(--ink-muted)] block mb-2">Content</span>
          <textarea
            value={segment.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            placeholder="Enter text..."
            className="w-full h-20 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2 py-1.5 resize-none"
          />
        </div>

        <div>
          <span className="text-xs text-[var(--ink-muted)] block mb-2">Font</span>
          <Popover
            open={fontComboboxOpen}
            onOpenChange={(open) => {
              setFontComboboxOpen(open);
              if (open) ensureSystemFontsLoaded();
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-8 w-full items-center justify-between rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-left text-sm text-[var(--ink-dark)]"
                style={{ fontFamily: segment.fontFamily }}
              >
                <span className="truncate">{segment.fontFamily}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-[var(--ink-subtle)]" />
              </button>
            </PopoverTrigger>
            {fontComboboxOpen && (
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] border-[var(--glass-border)] bg-[var(--glass-surface-dark)] p-0"
                align="start"
              >
                <Command className="bg-transparent text-[var(--ink-dark)]">
                  <CommandInput placeholder="Search fonts..." className="h-9" />
                  <CommandList className="max-h-[260px]">
                    <CommandEmpty>
                      {isLoadingFonts ? 'Loading fonts...' : 'No font found.'}
                    </CommandEmpty>
                    <CommandGroup>
                      {fontFamilies.map((font) => (
                        <CommandItem
                          key={font}
                          value={font}
                          onSelect={() => {
                            onUpdate({ fontFamily: font });
                            setFontComboboxOpen(false);
                          }}
                          style={{ fontFamily: font }}
                          className="text-sm"
                        >
                          <Check
                            className={cn(
                              'mr-2 h-4 w-4',
                              segment.fontFamily === font ? 'opacity-100' : 'opacity-0'
                            )}
                          />
                          {font}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            )}
          </Popover>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--ink-muted)]">Size</span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">{segment.fontSize}px</span>
          </div>
          <Slider
            value={[segment.fontSize]}
            min={12}
            max={200}
            step={2}
            onValueChange={(values) => onUpdate({ fontSize: values[0] })}
          />
        </div>

        <div className="flex items-end gap-2">
          <div className="flex-1">
            <span className="text-xs text-[var(--ink-muted)] block mb-2">Weight</span>
            <Select
              value={String(segment.fontWeight)}
              onValueChange={(value) => onUpdate({ fontWeight: Number.parseInt(value, 10) })}
            >
              <SelectTrigger className="h-8 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
                {availableWeights.map((weight) => (
                  <SelectItem key={weight} value={String(weight)}>
                    {WEIGHT_LABELS[weight] || `Weight ${weight}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <button
            type="button"
            onClick={() => onUpdate({ italic: !segment.italic })}
            className={`h-8 w-8 flex items-center justify-center rounded-md border transition-colors ${
              segment.italic
                ? 'bg-[var(--coral-100)] border-[var(--coral-300)] text-[var(--coral-500)]'
                : 'bg-[var(--polar-mist)] border-[var(--glass-border)] text-[var(--ink-muted)]'
            }`}
            aria-label="Toggle italic"
          >
            <Italic className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">Color</span>
          <input
            type="color"
            value={segment.color || TEXT_STYLE.DEFAULT_COLOR}
            onChange={(e) => onUpdate({ color: e.target.value })}
            className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
          />
        </div>
      </ConfigSection>

      <ConfigSection title="Text Outline">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">Enabled</span>
          <ToggleSwitch
            enabled={hasStroke}
            onToggle={() => onUpdate({
              strokeColor: hasStroke ? null : strokeColor,
              strokeWidth: hasStroke ? 0 : TEXT_STYLE.DEFAULT_STROKE_WIDTH,
            })}
          />
        </div>
        {hasStroke && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--ink-subtle)]">Color</span>
              <input
                type="color"
                value={strokeColor}
                onChange={(e) => onUpdate({ strokeColor: e.target.value })}
                className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--ink-subtle)]">Width</span>
                <span className="text-xs text-[var(--ink-dark)] font-mono">{strokeWidth}px</span>
              </div>
              <Slider
                value={[strokeWidth]}
                min={TEXT_STYLE.MIN_STROKE_WIDTH}
                max={TEXT_STYLE.MAX_STROKE_WIDTH}
                step={1}
                onValueChange={(values) => onUpdate({ strokeWidth: values[0] })}
              />
            </div>
          </>
        )}
      </ConfigSection>

      <ConfigSection title="Background">
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">Fill</span>
          <ToggleSwitch
            enabled={hasBackground}
            onToggle={() => onUpdate({ backgroundColor: hasBackground ? null : backgroundColor })}
          />
        </div>
        {hasBackground && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-subtle)]">Fill Color</span>
            <input
              type="color"
              value={backgroundColor}
              onChange={(e) => onUpdate({ backgroundColor: e.target.value })}
              className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
            />
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">Stroke</span>
          <ToggleSwitch
            enabled={hasBackgroundStroke}
            onToggle={() => onUpdate({
              backgroundStrokeColor: hasBackgroundStroke ? null : backgroundStrokeColor,
              backgroundStrokeWidth: hasBackgroundStroke ? 0 : TEXT_STYLE.DEFAULT_BACKGROUND_STROKE_WIDTH,
            })}
          />
        </div>
        {hasBackgroundStroke && (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--ink-subtle)]">Stroke Color</span>
              <input
                type="color"
                value={backgroundStrokeColor}
                onChange={(e) => onUpdate({ backgroundStrokeColor: e.target.value })}
                className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[var(--ink-subtle)]">Stroke Width</span>
                <span className="text-xs text-[var(--ink-dark)] font-mono">{backgroundStrokeWidth}px</span>
              </div>
              <Slider
                value={[backgroundStrokeWidth]}
                min={TEXT_STYLE.MIN_STROKE_WIDTH}
                max={TEXT_STYLE.MAX_STROKE_WIDTH}
                step={1}
                onValueChange={(values) => onUpdate({ backgroundStrokeWidth: values[0] })}
              />
            </div>
          </>
        )}
      </ConfigSection>

      <ConfigSection title="Motion">
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-[var(--ink-muted)]">Fade Duration</span>
            <span className="text-xs text-[var(--ink-dark)] font-mono">{segment.fadeDuration.toFixed(2)}s</span>
          </div>
          <Slider
            value={[segment.fadeDuration * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={(values) => onUpdate({ fadeDuration: values[0] / 100 })}
          />
        </div>

        <div>
          <span className="text-xs text-[var(--ink-muted)] block mb-2">Animation</span>
          <Select
            value={animation}
            onValueChange={(value) => {
              const nextAnimation = value as TextAnimation;
              const updates: Partial<TextSegment> = { animation: nextAnimation };
              if (nextAnimation === 'typeWriter' && segment.typewriterCharsPerSecond == null) {
                updates.typewriterCharsPerSecond = TEXT_ANIMATION.DEFAULT_TYPEWRITER_CHARS_PER_SECOND;
              }
              if (nextAnimation === 'typeWriter' && segment.typewriterSoundEnabled == null) {
                updates.typewriterSoundEnabled = false;
              }
              onUpdate(updates);
            }}
          >
            <SelectTrigger className="h-8 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
              {ANIMATION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {animation === 'typeWriter' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[var(--ink-muted)]">Typing Speed</span>
              <span className="text-xs text-[var(--ink-dark)] font-mono">
                {typewriterCharsPerSecond.toFixed(0)} chars/s
              </span>
            </div>
            <Slider
              value={[typewriterCharsPerSecond]}
              min={TEXT_ANIMATION.MIN_TYPEWRITER_CHARS_PER_SECOND}
              max={TEXT_ANIMATION.MAX_TYPEWRITER_CHARS_PER_SECOND}
              step={1}
              onValueChange={(values) => onUpdate({ typewriterCharsPerSecond: values[0] })}
            />

            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-[var(--ink-muted)]">Typing Sound</span>
              <ToggleSwitch
                enabled={typewriterSoundEnabled}
                onToggle={() => onUpdate({ typewriterSoundEnabled: !typewriterSoundEnabled })}
              />
            </div>
          </div>
        )}
      </ConfigSection>

    </div>
  );
}
