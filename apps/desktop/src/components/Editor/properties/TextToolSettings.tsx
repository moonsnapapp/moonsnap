import React, { useState, useEffect } from 'react';
import {
  Check,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ChevronDown,
} from 'lucide-react';
import { useEditorStore } from '../../../stores/editorStore';
import { useEditorHistory } from '../../../hooks/useEditorHistory';
import { DEFAULT_FONT_FAMILIES, type CanvasShape } from '../../../types';
import {
  getEditorTextDecoration,
  getEditorTextFontFamily,
  getEditorTextFontStyle,
  isEditorTextStyleBold,
  isEditorTextStyleItalic,
  measureEditorTextBoxHeight,
  normalizeEditorTextAlign,
  normalizeEditorTextVerticalAlign,
  toggleEditorTextFontStyle,
  type EditorTextAlign,
  type EditorTextVerticalAlign,
} from '../../../utils/editorText';
import { editorLogger } from '@/utils/logger';
import { getSystemFonts, getSystemFontsSnapshot } from '@/utils/systemFonts';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { ColorPicker } from '@/components/ui/color-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

// Color presets for quick selection
const COLOR_PRESETS = [
  '#EF4444', '#F97316', '#9CA3AF', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#FFFFFF', '#1A1A1A',
];
const TRANSPARENT_COLOR = 'transparent';

interface TextToolSettingsProps {
  textShape: CanvasShape | null;
  strokeColor: string;
  strokeWidth: number;
  onStrokeColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
}

type UpdateShape = (id: string, updates: Partial<CanvasShape>) => void;
type RecordEditorAction = (action: () => void) => void;

interface FontFamilyPickerProps {
  disabled: boolean;
  currentFontFamily: string;
  fonts: string[];
  open: boolean;
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectFont: (font: string) => void;
}

function FontFamilyPicker({
  disabled,
  currentFontFamily,
  fonts,
  open,
  isLoading,
  onOpenChange,
  onSelectFont,
}: FontFamilyPickerProps) {
  return (
    <div className="space-y-3">
      <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Font Family</Label>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            disabled={disabled}
            className="w-full h-9 px-3 pr-8 rounded-md text-xs font-medium bg-transparent hover:bg-white/[0.04] text-[var(--ink-dark)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between text-left relative transition-colors"
            style={{ fontFamily: currentFontFamily }}
          >
            <span className="truncate">{currentFontFamily}</span>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)]" />
          </button>
        </PopoverTrigger>
        {open && (
          <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
            <Command>
              <CommandInput placeholder="Search fonts..." className="h-9" />
              <CommandList>
                <CommandEmpty>{isLoading ? 'Loading fonts...' : 'No font found.'}</CommandEmpty>
                <CommandGroup>
                  {fonts.map((font) => (
                    <CommandItem
                      key={font}
                      value={font}
                      onSelect={() => onSelectFont(font)}
                      style={{ fontFamily: font }}
                      className="text-sm"
                    >
                      <Check
                        className={`mr-2 h-4 w-4 ${currentFontFamily === font ? 'opacity-100' : 'opacity-0'}`}
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
  );
}

interface IconToggleButtonProps {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function IconToggleButton({
  active,
  disabled,
  onClick,
  children,
}: IconToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? 'editor-choice-pill--active' : ''
      }`}
    >
      {children}
    </button>
  );
}

interface TextToggleButtonProps {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  label: string;
}

function TextToggleButton({
  active,
  disabled,
  onClick,
  label,
}: TextToggleButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`editor-choice-pill flex-1 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
        active ? 'editor-choice-pill--active' : ''
      }`}
    >
      {label}
    </button>
  );
}

interface ColorSettingProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
}

function ColorSetting({ label, value, onChange }: ColorSettingProps) {
  return (
    <div className="space-y-3">
      <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">{label}</Label>
      <ColorPicker
        value={value}
        onChange={onChange}
        presets={COLOR_PRESETS}
        showTransparent
      />
    </div>
  );
}

interface WidthSliderSettingProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

function WidthSliderSetting({
  label,
  value,
  min,
  max,
  step,
  disabled = false,
  onChange,
}: WidthSliderSettingProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">{label}</Label>
        <span className="text-xs text-[var(--ink-dark)] font-mono">{value}px</span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([nextValue]) => onChange(nextValue)}
        min={min}
        max={max}
        step={step}
        className={`w-full ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
      />
    </div>
  );
}

function useSystemFontOptions() {
  const [systemFonts, setSystemFonts] = useState<string[]>(
    () => getSystemFontsSnapshot() ?? [...DEFAULT_FONT_FAMILIES]
  );
  const [fontComboboxOpen, setFontComboboxOpen] = useState(false);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);

  useEffect(() => {
    if (!fontComboboxOpen) return;
    const cached = getSystemFontsSnapshot();
    if (cached) {
      if (systemFonts !== cached) {
        setSystemFonts(cached);
      }
      return;
    }

    let cancelled = false;
    setIsLoadingFonts(true);
    getSystemFonts()
      .then((fonts) => {
        if (!cancelled && fonts.length > 0) {
          setSystemFonts(fonts);
        }
      })
      .catch((err) => {
        editorLogger.warn('Failed to load system fonts:', err);
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingFonts(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [fontComboboxOpen, systemFonts]);

  return {
    systemFonts,
    fontComboboxOpen,
    setFontComboboxOpen,
    isLoadingFonts,
  };
}

function getShapeValue<T>(value: T | null | undefined, fallback: T): T {
  return value || fallback;
}

function getTextToolStyleValues(textShape: CanvasShape | null) {
  const fontStyle = getEditorTextFontStyle(textShape?.fontStyle);
  const textDecoration = getEditorTextDecoration(textShape?.textDecoration);

  return {
    fontStyle,
    textDecoration,
    isBold: isEditorTextStyleBold(fontStyle),
    isItalic: isEditorTextStyleItalic(fontStyle),
    isUnderline: textDecoration === 'underline',
  };
}

function getTextToolShapeValues(textShape: CanvasShape | null, fallbackFontSize: number) {
  const {
    fontSize,
    fontFamily,
    align,
    stroke,
    strokeWidth,
    verticalAlign,
    textBackground,
    textBoxStroke,
    textBoxStrokeWidth,
  } = textShape ?? {};

  return {
    currentFontSize: getShapeValue(fontSize, fallbackFontSize),
    currentFontFamily: getEditorTextFontFamily(fontFamily),
    currentAlign: normalizeEditorTextAlign(align),
    currentTextStroke: getShapeValue(stroke, TRANSPARENT_COLOR),
    currentTextStrokeWidth: getShapeValue(strokeWidth, 0),
    currentVerticalAlign: normalizeEditorTextVerticalAlign(verticalAlign),
    currentTextBackground: getShapeValue(textBackground, TRANSPARENT_COLOR),
    currentTextBoxStroke: getShapeValue(textBoxStroke, TRANSPARENT_COLOR),
    currentTextBoxStrokeWidth: getShapeValue(textBoxStrokeWidth, 0),
  };
}

function getTextToolValues(textShape: CanvasShape | null, fallbackFontSize: number) {
  const { fontStyle, textDecoration, isBold, isItalic, isUnderline } =
    getTextToolStyleValues(textShape);

  return {
    ...getTextToolShapeValues(textShape, fallbackFontSize),
    currentFontStyle: fontStyle,
    currentTextDecoration: textDecoration,
    isBold,
    isItalic,
    isUnderline,
  };
}

function getFontSizeShapeUpdate(textShape: CanvasShape, fontSize: number): Partial<CanvasShape> {
  const measuredHeight = measureEditorTextBoxHeight(textShape, fontSize);
  return {
    fontSize,
    height: Math.max(textShape.height || 0, measuredHeight),
  };
}

function updateSelectedTextShape(
  textShape: CanvasShape | null,
  updateShape: UpdateShape,
  recordAction: RecordEditorAction,
  updates: Partial<CanvasShape>
) {
  if (!textShape) return false;
  recordAction(() => updateShape(textShape.id, updates));
  return true;
}

function updateSelectedTextShapeLive(
  textShape: CanvasShape | null,
  updateShape: UpdateShape,
  updates: Partial<CanvasShape>
) {
  if (!textShape) return false;
  updateShape(textShape.id, updates);
  return true;
}

function updateFontSizeValue(
  textShape: CanvasShape | null,
  updateShape: UpdateShape,
  setFontSize: (fontSize: number) => void,
  value: number
) {
  if (!textShape) {
    setFontSize(value);
    return;
  }

  updateShape(textShape.id, getFontSizeShapeUpdate(textShape, value));
}

function getUnderlineDecoration(isUnderline: boolean) {
  return isUnderline ? '' : 'underline';
}

function getOpaqueColorValue(color: string, fallback: string) {
  return color === 'transparent' ? fallback : color;
}

function getSelectedOrDefaultValue<T>(textShape: CanvasShape | null, selectedValue: T, defaultValue: T) {
  return textShape ? selectedValue : defaultValue;
}

export const TextToolSettings: React.FC<TextToolSettingsProps> = ({
  textShape,
  strokeColor,
  strokeWidth,
  onStrokeColorChange,
  onStrokeWidthChange,
}) => {
  const { fontSize, setFontSize, updateShape } = useEditorStore();
  const { recordAction } = useEditorHistory();

  const {
    systemFonts,
    fontComboboxOpen,
    setFontComboboxOpen,
    isLoadingFonts,
  } = useSystemFontOptions();
  const {
    currentFontSize,
    currentFontFamily,
    currentFontStyle,
    currentAlign,
    currentTextStroke,
    currentTextStrokeWidth,
    currentVerticalAlign,
    currentTextBackground,
    currentTextBoxStroke,
    currentTextBoxStrokeWidth,
    isBold,
    isItalic,
    isUnderline,
  } = getTextToolValues(textShape, fontSize);

  const handleFontSizeChange = ([value]: number[]) => {
    updateFontSizeValue(textShape, updateShape, setFontSize, value);
  };

  const toggleBold = () => {
    updateSelectedTextShape(textShape, updateShape, recordAction, {
      fontStyle: toggleEditorTextFontStyle(currentFontStyle, 'bold'),
    });
  };

  const toggleItalic = () => {
    updateSelectedTextShape(textShape, updateShape, recordAction, {
      fontStyle: toggleEditorTextFontStyle(currentFontStyle, 'italic'),
    });
  };

  const toggleUnderline = () => {
    updateSelectedTextShape(textShape, updateShape, recordAction, {
      textDecoration: getUnderlineDecoration(isUnderline),
    });
  };

  const setAlignment = (align: EditorTextAlign) => {
    updateSelectedTextShape(textShape, updateShape, recordAction, { align });
  };

  const setVerticalAlignment = (verticalAlign: EditorTextVerticalAlign) => {
    updateSelectedTextShape(textShape, updateShape, recordAction, { verticalAlign });
  };

  return (
    <>
      {/* Font Family */}
      <Separator className="bg-[var(--polar-frost)]" />
      <FontFamilyPicker
        disabled={!textShape}
        currentFontFamily={currentFontFamily}
        fonts={systemFonts}
        open={fontComboboxOpen}
        isLoading={isLoadingFonts}
        onOpenChange={setFontComboboxOpen}
        onSelectFont={(font) => {
          updateSelectedTextShape(textShape, updateShape, recordAction, { fontFamily: font });
          setFontComboboxOpen(false);
        }}
      />

      {/* Font Size */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Font Size</Label>
          <span className="text-xs text-[var(--ink-dark)] font-mono">{currentFontSize}px</span>
        </div>
        <Slider
          value={[currentFontSize]}
          onValueChange={handleFontSizeChange}
          onValueCommit={() => {
            // Commit handled by recordAction on individual changes
          }}
          min={8}
          max={100}
          step={1}
          className="w-full"
        />
      </div>

      {/* Bold, Italic, Underline */}
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Style</Label>
        <div className="flex gap-1.5">
          <IconToggleButton active={isBold} disabled={!textShape} onClick={toggleBold}>
            <Bold className="w-4 h-4" />
          </IconToggleButton>
          <IconToggleButton active={isItalic} disabled={!textShape} onClick={toggleItalic}>
            <Italic className="w-4 h-4" />
          </IconToggleButton>
          <IconToggleButton active={isUnderline} disabled={!textShape} onClick={toggleUnderline}>
            <Underline className="w-4 h-4" />
          </IconToggleButton>
        </div>
      </div>

      {/* Text Alignment - Horizontal */}
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Horizontal Align</Label>
        <div className="flex gap-1.5">
          <IconToggleButton
            active={currentAlign === 'left'}
            disabled={!textShape}
            onClick={() => setAlignment('left')}
          >
            <AlignLeft className="w-4 h-4" />
          </IconToggleButton>
          <IconToggleButton
            active={currentAlign === 'center'}
            disabled={!textShape}
            onClick={() => setAlignment('center')}
          >
            <AlignCenter className="w-4 h-4" />
          </IconToggleButton>
          <IconToggleButton
            active={currentAlign === 'right'}
            disabled={!textShape}
            onClick={() => setAlignment('right')}
          >
            <AlignRight className="w-4 h-4" />
          </IconToggleButton>
        </div>
      </div>

      {/* Text Alignment - Vertical */}
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Vertical Align</Label>
        <div className="flex gap-1.5">
          <TextToggleButton
            active={currentVerticalAlign === 'top'}
            disabled={!textShape}
            onClick={() => setVerticalAlignment('top')}
            label="Top"
          />
          <TextToggleButton
            active={currentVerticalAlign === 'middle'}
            disabled={!textShape}
            onClick={() => setVerticalAlignment('middle')}
            label="Middle"
          />
          <TextToggleButton
            active={currentVerticalAlign === 'bottom'}
            disabled={!textShape}
            onClick={() => setVerticalAlignment('bottom')}
            label="Bottom"
          />
        </div>
      </div>

      {/* Text Background Color */}
      <Separator className="bg-[var(--polar-frost)]" />
      <ColorSetting
        label="Background Color"
        value={getOpaqueColorValue(currentTextBackground, '#FFFFFF')}
        onChange={(color) => updateSelectedTextShape(textShape, updateShape, recordAction, { textBackground: color })}
      />

      {/* Text Box Outline */}
      <ColorSetting
        label="Box Outline"
        value={getOpaqueColorValue(currentTextBoxStroke, '#000000')}
        onChange={(color) => updateSelectedTextShape(textShape, updateShape, recordAction, { textBoxStroke: color })}
      />
      <WidthSliderSetting
        label="Outline Width"
        value={currentTextBoxStrokeWidth}
        min={0}
        max={8}
        step={1}
        disabled={!textShape}
        onChange={(value) => updateSelectedTextShapeLive(textShape, updateShape, { textBoxStrokeWidth: value })}
      />

      {/* Text Stroke - show for text tool and selected text shapes */}
      <>
        <Separator className="bg-[var(--polar-frost)]" />
        <ColorSetting
          label="Stroke Color"
          value={getSelectedOrDefaultValue(
            textShape,
            getOpaqueColorValue(currentTextStroke, '#000000'),
            strokeColor
          )}
          onChange={(color) => {
            if (!updateSelectedTextShape(textShape, updateShape, recordAction, { stroke: color })) {
              onStrokeColorChange(color);
            }
          }}
        />
        <WidthSliderSetting
          label="Stroke Width"
          value={getSelectedOrDefaultValue(textShape, currentTextStrokeWidth, strokeWidth)}
          min={0}
          max={4}
          step={0.5}
          onChange={(value) => {
            if (!updateSelectedTextShapeLive(textShape, updateShape, { strokeWidth: value })) {
              onStrokeWidthChange(value);
            }
          }}
        />
      </>
    </>
  );
};
