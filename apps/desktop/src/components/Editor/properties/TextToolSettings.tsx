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
  '#EF4444', '#F97316', '#F97066', '#22C55E',
  '#3B82F6', '#8B5CF6', '#EC4899', '#FFFFFF', '#1A1A1A',
];

interface TextToolSettingsProps {
  textShape: CanvasShape | null;
  strokeColor: string;
  strokeWidth: number;
  onStrokeColorChange: (color: string) => void;
  onStrokeWidthChange: (width: number) => void;
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

  // System fonts state
  const [systemFonts, setSystemFonts] = useState<string[]>(
    () => getSystemFontsSnapshot() ?? [...DEFAULT_FONT_FAMILIES]
  );
  const [fontComboboxOpen, setFontComboboxOpen] = useState(false);
  const [isLoadingFonts, setIsLoadingFonts] = useState(false);

  // Load system fonts lazily when the font picker is opened.
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

  const currentFontSize = textShape?.fontSize || fontSize;
  const currentFontFamily = getEditorTextFontFamily(textShape?.fontFamily);
  const currentFontStyle = getEditorTextFontStyle(textShape?.fontStyle);
  const currentTextDecoration = getEditorTextDecoration(textShape?.textDecoration);
  const currentAlign = normalizeEditorTextAlign(textShape?.align);
  const currentTextStroke = textShape?.stroke || 'transparent';
  const currentTextStrokeWidth = textShape?.strokeWidth || 0;
  const currentVerticalAlign = normalizeEditorTextVerticalAlign(textShape?.verticalAlign);
  const currentTextBackground = textShape?.textBackground || 'transparent';
  const currentTextBoxStroke = textShape?.textBoxStroke || 'transparent';
  const currentTextBoxStrokeWidth = textShape?.textBoxStrokeWidth || 0;

  const isBold = isEditorTextStyleBold(currentFontStyle);
  const isItalic = isEditorTextStyleItalic(currentFontStyle);
  const isUnderline = currentTextDecoration === 'underline';

  const toggleBold = () => {
    if (textShape) {
      recordAction(() => updateShape(textShape.id, {
        fontStyle: toggleEditorTextFontStyle(currentFontStyle, 'bold'),
      }));
    }
  };

  const toggleItalic = () => {
    if (textShape) {
      recordAction(() => updateShape(textShape.id, {
        fontStyle: toggleEditorTextFontStyle(currentFontStyle, 'italic'),
      }));
    }
  };

  const toggleUnderline = () => {
    const newDecoration = isUnderline ? '' : 'underline';
    if (textShape) {
      recordAction(() => updateShape(textShape.id, { textDecoration: newDecoration }));
    }
  };

  const setAlignment = (align: EditorTextAlign) => {
    if (textShape) {
      recordAction(() => updateShape(textShape.id, { align }));
    }
  };

  const setVerticalAlignment = (verticalAlign: EditorTextVerticalAlign) => {
    if (textShape) {
      recordAction(() => updateShape(textShape.id, { verticalAlign }));
    }
  };

  return (
    <>
      {/* Font Family */}
      <Separator className="bg-[var(--polar-frost)]" />
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Font Family</Label>
        <Popover open={fontComboboxOpen} onOpenChange={setFontComboboxOpen}>
          <PopoverTrigger asChild>
            <button
              disabled={!textShape}
              className="w-full h-9 px-3 pr-8 rounded-lg text-xs font-medium bg-[var(--card)] border border-[var(--polar-frost)] text-[var(--ink-dark)] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-between text-left relative"
              style={{ fontFamily: currentFontFamily }}
            >
              <span className="truncate">{currentFontFamily}</span>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--ink-muted)]" />
            </button>
          </PopoverTrigger>
          {fontComboboxOpen && (
            <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start">
              <Command>
                <CommandInput placeholder="Search fonts..." className="h-9" />
                <CommandList>
                  <CommandEmpty>{isLoadingFonts ? 'Loading fonts...' : 'No font found.'}</CommandEmpty>
                  <CommandGroup>
                    {systemFonts.map((font) => (
                      <CommandItem
                        key={font}
                        value={font}
                        onSelect={() => {
                          if (textShape) {
                            recordAction(() => updateShape(textShape.id, { fontFamily: font }));
                          }
                          setFontComboboxOpen(false);
                        }}
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

      {/* Font Size */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Font Size</Label>
          <span className="text-xs text-[var(--ink-dark)] font-mono">{currentFontSize}px</span>
        </div>
        <Slider
          value={[currentFontSize]}
          onValueChange={([value]) => {
            if (textShape) {
              const measuredHeight = measureEditorTextBoxHeight(textShape, value);
              updateShape(textShape.id, {
                fontSize: value,
                height: Math.max(textShape.height || 0, measuredHeight),
              });
            } else {
              setFontSize(value);
            }
          }}
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
          <button
            onClick={toggleBold}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isBold ? 'editor-choice-pill--active' : ''
            }`}
          >
            <Bold className="w-4 h-4" />
          </button>
          <button
            onClick={toggleItalic}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isItalic ? 'editor-choice-pill--active' : ''
            }`}
          >
            <Italic className="w-4 h-4" />
          </button>
          <button
            onClick={toggleUnderline}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isUnderline ? 'editor-choice-pill--active' : ''
            }`}
          >
            <Underline className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Text Alignment - Horizontal */}
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Horizontal Align</Label>
        <div className="flex gap-1.5">
          <button
            onClick={() => setAlignment('left')}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              currentAlign === 'left' ? 'editor-choice-pill--active' : ''
            }`}
          >
            <AlignLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAlignment('center')}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              currentAlign === 'center' ? 'editor-choice-pill--active' : ''
            }`}
          >
            <AlignCenter className="w-4 h-4" />
          </button>
          <button
            onClick={() => setAlignment('right')}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 flex items-center justify-center px-2 py-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              currentAlign === 'right' ? 'editor-choice-pill--active' : ''
            }`}
          >
            <AlignRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Text Alignment - Vertical */}
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Vertical Align</Label>
        <div className="flex gap-1.5">
          <button
            onClick={() => setVerticalAlignment('top')}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
              currentVerticalAlign === 'top' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Top
          </button>
          <button
            onClick={() => setVerticalAlignment('middle')}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
              currentVerticalAlign === 'middle' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Middle
          </button>
          <button
            onClick={() => setVerticalAlignment('bottom')}
            disabled={!textShape}
            className={`editor-choice-pill flex-1 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
              currentVerticalAlign === 'bottom' ? 'editor-choice-pill--active' : ''
            }`}
          >
            Bottom
          </button>
        </div>
      </div>

      {/* Text Background Color */}
      <Separator className="bg-[var(--polar-frost)]" />
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Background Color</Label>
        <ColorPicker
          value={currentTextBackground === 'transparent' ? '#FFFFFF' : currentTextBackground}
          onChange={(color) => {
            if (textShape) {
              recordAction(() => updateShape(textShape.id, { textBackground: color }));
            }
          }}
          presets={COLOR_PRESETS}
          showTransparent
        />
      </div>

      {/* Text Box Outline */}
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Box Outline</Label>
        <ColorPicker
          value={currentTextBoxStroke === 'transparent' ? '#000000' : currentTextBoxStroke}
          onChange={(color) => {
            if (textShape) {
              recordAction(() => updateShape(textShape.id, { textBoxStroke: color }));
            }
          }}
          presets={COLOR_PRESETS}
          showTransparent
        />
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Outline Width</Label>
          <span className="text-xs text-[var(--ink-dark)] font-mono">{currentTextBoxStrokeWidth}px</span>
        </div>
        <Slider
          value={[currentTextBoxStrokeWidth]}
          onValueChange={([value]) => {
            if (textShape) {
              updateShape(textShape.id, { textBoxStrokeWidth: value });
            }
          }}
          min={0}
          max={8}
          step={1}
          className={`w-full ${!textShape ? 'opacity-50 pointer-events-none' : ''}`}
        />
      </div>

      {/* Text Stroke - show for text tool and selected text shapes */}
      <>
        <Separator className="bg-[var(--polar-frost)]" />
        <div className="space-y-3">
          <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Stroke Color</Label>
          <ColorPicker
            value={textShape ? (currentTextStroke === 'transparent' ? '#000000' : currentTextStroke) : strokeColor}
            onChange={(color) => {
              if (textShape) {
                recordAction(() => updateShape(textShape.id, { stroke: color }));
              } else {
                onStrokeColorChange(color);
              }
            }}
            presets={COLOR_PRESETS}
            showTransparent
          />
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Stroke Width</Label>
            <span className="text-xs text-[var(--ink-dark)] font-mono">{textShape ? currentTextStrokeWidth : strokeWidth}px</span>
          </div>
          <Slider
            value={[textShape ? currentTextStrokeWidth : strokeWidth]}
            onValueChange={([value]) => {
              if (textShape) {
                updateShape(textShape.id, { strokeWidth: value });
              } else {
                onStrokeWidthChange(value);
              }
            }}
            min={0}
            max={4}
            step={0.5}
            className="w-full"
          />
        </div>
      </>
    </>
  );
};
