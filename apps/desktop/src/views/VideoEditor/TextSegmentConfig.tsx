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
          ? 'bg-[var(--accent-400)]'
          : 'bg-[var(--polar-frost)]'
      }`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
        enabled ? 'translate-x-5' : ''
      }`} />
    </button>
  );
}

function getTextSegmentAnimationState(animation: TextSegment['animation']) {
  return normalizeTextAnimation(animation) === 'typeWriter' ? 'typeWriter' as const : 'none' as const;
}

function hasTextSegmentBackground(segment: TextSegment) {
  return segment.backgroundColor != null;
}

function hasTextSegmentBackgroundStroke(segment: TextSegment, backgroundStrokeWidth: number) {
  return segment.backgroundStrokeColor != null && backgroundStrokeWidth > 0;
}

function getTextSegmentBackgroundState(segment: TextSegment) {
  const backgroundColor = segment.backgroundColor ?? TEXT_STYLE.DEFAULT_BACKGROUND_COLOR;
  const backgroundStrokeColor =
    segment.backgroundStrokeColor ?? TEXT_STYLE.DEFAULT_BACKGROUND_STROKE_COLOR;
  const backgroundStrokeWidth = segment.backgroundStrokeWidth ?? 0;

  return {
    backgroundColor,
    backgroundStrokeColor,
    backgroundStrokeWidth,
    hasBackground: hasTextSegmentBackground(segment),
    hasBackgroundStroke: hasTextSegmentBackgroundStroke(segment, backgroundStrokeWidth),
  };
}

function getTextSegmentStrokeState(segment: TextSegment) {
  const strokeColor = segment.strokeColor ?? TEXT_STYLE.DEFAULT_STROKE_COLOR;
  const strokeWidth = segment.strokeWidth ?? 0;

  return {
    strokeColor,
    strokeWidth,
    hasStroke: segment.strokeColor != null && strokeWidth > 0,
  };
}

function getTextSegmentStyleState(segment: TextSegment) {
  const backgroundState = getTextSegmentBackgroundState(segment);
  const strokeState = getTextSegmentStrokeState(segment);

  return {
    animation: getTextSegmentAnimationState(segment.animation),
    typewriterCharsPerSecond: getTypewriterCharsPerSecond(segment),
    typewriterSoundEnabled: segment.typewriterSoundEnabled ?? false,
    ...backgroundState,
    ...strokeState,
  };
}

function getAnimationUpdates(
  value: string,
  segment: TextSegment
): Partial<TextSegment> {
  const nextAnimation = value as TextAnimation;
  const updates: Partial<TextSegment> = { animation: nextAnimation };
  if (nextAnimation !== 'typeWriter') {
    return updates;
  }

  if (segment.typewriterCharsPerSecond == null) {
    updates.typewriterCharsPerSecond = TEXT_ANIMATION.DEFAULT_TYPEWRITER_CHARS_PER_SECOND;
  }
  if (segment.typewriterSoundEnabled == null) {
    updates.typewriterSoundEnabled = false;
  }
  return updates;
}

function getFontFamilies(systemFonts: string[], currentFont: string | undefined): string[] {
  const fonts = systemFonts.length > 0 ? systemFonts : DEFAULT_FONT_FAMILIES;
  if (currentFont && !fonts.includes(currentFont)) {
    return [currentFont, ...fonts];
  }
  return fonts;
}

function getClosestFontWeight(weights: number[], currentWeight: number): number {
  return weights.reduce((prev, curr) =>
    Math.abs(curr - currentWeight) < Math.abs(prev - currentWeight) ? curr : prev
  );
}

function useTextSegmentFonts(segment: TextSegment, onUpdate: TextSegmentConfigProps['onUpdate']) {
  const cachedFonts = getSystemFontsSnapshot();
  const [systemFonts, setSystemFonts] = useState<string[]>(() => cachedFonts ?? []);
  const [fontComboboxOpen, setFontComboboxOpen] = useState(false);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);
  const [hasRequestedFonts, setHasRequestedFonts] = useState(() => cachedFonts !== null);
  const [availableWeights, setAvailableWeights] = useState<number[]>([400, 700]);

  const fontFamilies = useMemo(
    () => getFontFamilies(systemFonts, segment.fontFamily),
    [systemFonts, segment.fontFamily]
  );

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

  useEffect(() => {
    if (!segment.fontFamily || segment.fontFamily === 'sans-serif') {
      setAvailableWeights([400, 700]);
      return;
    }

    invoke<number[]>('get_font_weights', { family: segment.fontFamily })
      .then((weights) => {
        if (weights && weights.length > 0) {
          setAvailableWeights(weights);
          if (!weights.includes(segment.fontWeight)) {
            onUpdate({ fontWeight: getClosestFontWeight(weights, segment.fontWeight) });
          }
        }
      })
      .catch((err) => {
        videoEditorLogger.warn('Failed to load font weights:', err);
        setAvailableWeights([400, 700]);
      });
  }, [onUpdate, segment.fontFamily, segment.fontWeight]);

  return {
    availableWeights,
    fontComboboxOpen,
    fontFamilies,
    isLoadingFonts,
    setFontComboboxOpen,
    ensureSystemFontsLoaded,
  };
}

type TextSegmentStyleState = ReturnType<typeof getTextSegmentStyleState>;

function TextSegmentHeader({
  onDelete,
  onDone,
}: {
  onDelete: TextSegmentConfigProps['onDelete'];
  onDone: TextSegmentConfigProps['onDone'];
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <button
          onClick={onDone}
          className="h-7 px-2.5 bg-[var(--accent-100)] hover:bg-[var(--accent-200)] text-[var(--accent-400)] text-xs font-medium rounded-md transition-colors"
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
  );
}

function TextOutlineSection({
  styleState,
  onUpdate,
}: {
  styleState: TextSegmentStyleState;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  const { hasStroke, strokeColor, strokeWidth } = styleState;

  return (
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
  );
}

function BackgroundSection({
  styleState,
  onUpdate,
}: {
  styleState: TextSegmentStyleState;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  const {
    backgroundColor,
    backgroundStrokeColor,
    backgroundStrokeWidth,
    hasBackground,
    hasBackgroundStroke,
  } = styleState;

  return (
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
            backgroundStrokeWidth: hasBackgroundStroke
              ? 0
              : TEXT_STYLE.DEFAULT_BACKGROUND_STROKE_WIDTH,
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
              <span className="text-xs text-[var(--ink-dark)] font-mono">
                {backgroundStrokeWidth}px
              </span>
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
  );
}

function MotionSection({
  segment,
  styleState,
  onUpdate,
}: {
  segment: TextSegment;
  styleState: TextSegmentStyleState;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  const { animation, typewriterCharsPerSecond, typewriterSoundEnabled } = styleState;

  return (
    <ConfigSection title="Motion">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Fade Duration</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">
            {segment.fadeDuration.toFixed(2)}s
          </span>
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
          onValueChange={(value) => onUpdate(getAnimationUpdates(value, segment))}
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
  );
}

function TextContentField({
  segment,
  onUpdate,
}: {
  segment: TextSegment;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  return (
    <div>
      <span className="text-xs text-[var(--ink-muted)] block mb-2">Content</span>
      <textarea
        value={segment.content}
        onChange={(e) => onUpdate({ content: e.target.value })}
        placeholder="Enter text..."
        className="w-full h-20 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2 py-1.5 resize-none"
      />
    </div>
  );
}

function getFontEmptyText(isLoadingFonts: boolean) {
  return isLoadingFonts ? 'Loading fonts...' : 'No font found.';
}

function getFontCheckClass(isSelected: boolean) {
  return cn('mr-2 h-4 w-4', isSelected ? 'opacity-100' : 'opacity-0');
}

function FontFamilyControl({
  segment,
  fontComboboxOpen,
  fontFamilies,
  isLoadingFonts,
  setFontComboboxOpen,
  ensureSystemFontsLoaded,
  onUpdate,
}: {
  segment: TextSegment;
  fontComboboxOpen: boolean;
  fontFamilies: string[];
  isLoadingFonts: boolean;
  setFontComboboxOpen: (open: boolean) => void;
  ensureSystemFontsLoaded: () => void;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  const handleOpenChange = (open: boolean) => {
    setFontComboboxOpen(open);
    if (open) ensureSystemFontsLoaded();
  };

  return (
    <div>
      <span className="text-xs text-[var(--ink-muted)] block mb-2">Font</span>
      <Popover open={fontComboboxOpen} onOpenChange={handleOpenChange}>
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
                <CommandEmpty>{getFontEmptyText(isLoadingFonts)}</CommandEmpty>
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
                      <Check className={getFontCheckClass(segment.fontFamily === font)} />
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
  );
}

function FontSizeControl({
  segment,
  onUpdate,
}: {
  segment: TextSegment;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  return (
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
  );
}

function getWeightLabel(weight: number) {
  return WEIGHT_LABELS[weight] || `Weight ${weight}`;
}

function getItalicButtonClass(isItalic: boolean) {
  const stateClass = isItalic
    ? 'bg-[var(--accent-100)] border-[var(--accent-300)] text-[var(--accent-500)]'
    : 'bg-[var(--polar-mist)] border-[var(--glass-border)] text-[var(--ink-muted)]';

  return `h-8 w-8 flex items-center justify-center rounded-md border transition-colors ${stateClass}`;
}

function FontWeightAndStyleControls({
  segment,
  availableWeights,
  onUpdate,
}: {
  segment: TextSegment;
  availableWeights: number[];
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  return (
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
                {getWeightLabel(weight)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <button
        type="button"
        onClick={() => onUpdate({ italic: !segment.italic })}
        className={getItalicButtonClass(segment.italic)}
        aria-label="Toggle italic"
      >
        <Italic className="w-4 h-4" />
      </button>
    </div>
  );
}

function TextColorControl({
  segment,
  onUpdate,
}: {
  segment: TextSegment;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--ink-muted)]">Color</span>
      <input
        type="color"
        value={segment.color || TEXT_STYLE.DEFAULT_COLOR}
        onChange={(e) => onUpdate({ color: e.target.value })}
        className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
      />
    </div>
  );
}

function TextSettingsSection({
  segment,
  availableWeights,
  fontComboboxOpen,
  fontFamilies,
  isLoadingFonts,
  setFontComboboxOpen,
  ensureSystemFontsLoaded,
  onUpdate,
}: {
  segment: TextSegment;
  availableWeights: number[];
  fontComboboxOpen: boolean;
  fontFamilies: string[];
  isLoadingFonts: boolean;
  setFontComboboxOpen: (open: boolean) => void;
  ensureSystemFontsLoaded: () => void;
  onUpdate: TextSegmentConfigProps['onUpdate'];
}) {
  return (
    <ConfigSection title="Text">
      <TextContentField segment={segment} onUpdate={onUpdate} />
      <FontFamilyControl
        segment={segment}
        fontComboboxOpen={fontComboboxOpen}
        fontFamilies={fontFamilies}
        isLoadingFonts={isLoadingFonts}
        setFontComboboxOpen={setFontComboboxOpen}
        ensureSystemFontsLoaded={ensureSystemFontsLoaded}
        onUpdate={onUpdate}
      />
      <FontSizeControl segment={segment} onUpdate={onUpdate} />
      <FontWeightAndStyleControls
        segment={segment}
        availableWeights={availableWeights}
        onUpdate={onUpdate}
      />
      <TextColorControl segment={segment} onUpdate={onUpdate} />
    </ConfigSection>
  );
}

export function TextSegmentConfig({ segment, onUpdate, onDelete, onDone }: TextSegmentConfigProps) {
  const styleState = getTextSegmentStyleState(segment);
  const {
    availableWeights,
    fontComboboxOpen,
    fontFamilies,
    isLoadingFonts,
    setFontComboboxOpen,
    ensureSystemFontsLoaded,
  } = useTextSegmentFonts(segment, onUpdate);

  return (
    <div className="space-y-4">
      <TextSegmentHeader onDelete={onDelete} onDone={onDone} />

      <TextSettingsSection
        segment={segment}
        availableWeights={availableWeights}
        fontComboboxOpen={fontComboboxOpen}
        fontFamilies={fontFamilies}
        isLoadingFonts={isLoadingFonts}
        setFontComboboxOpen={setFontComboboxOpen}
        ensureSystemFontsLoaded={ensureSystemFontsLoaded}
        onUpdate={onUpdate}
      />

      <TextOutlineSection styleState={styleState} onUpdate={onUpdate} />
      <BackgroundSection styleState={styleState} onUpdate={onUpdate} />
      <MotionSection segment={segment} styleState={styleState} onUpdate={onUpdate} />

    </div>
  );
}
