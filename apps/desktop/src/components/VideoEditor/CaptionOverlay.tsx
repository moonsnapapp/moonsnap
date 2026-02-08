/**
 * CaptionOverlay - Renders transcribed captions on the video preview.
 *
 * Displays captions with configurable styling including background for readability.
 */
import { memo, useMemo } from 'react';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useScaledLayout } from '@/hooks/useParityLayout';

interface CaptionOverlayProps {
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
}

function getCaptionTextContent(
  segment: { text: string; words: Array<{ text: string }> }
): string {
  if (segment.words.length > 0) {
    return segment.words.map((word) => word.text).join(' ');
  }
  return segment.text;
}

function resolveCaptionFontFamily(font: string | undefined): string {
  const normalized = font?.trim().toLowerCase() ?? '';

  if (
    normalized === '' ||
    normalized === 'sans' ||
    normalized === 'sans-serif' ||
    normalized === 'system sans' ||
    normalized === 'system sans-serif' ||
    normalized === 'system-ui'
  ) {
    return 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  }

  if (normalized === 'serif' || normalized === 'system serif') {
    return 'serif';
  }

  if (
    normalized === 'mono' ||
    normalized === 'monospace' ||
    normalized === 'system mono' ||
    normalized === 'system monospace'
  ) {
    return 'monospace';
  }

  return `${font}, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
}

function normalizeHexColor(hex: string): string {
  const cleaned = hex.trim().replace(/^#/, '');

  if (cleaned.length === 3 || cleaned.length === 4) {
    return cleaned
      .slice(0, 3)
      .split('')
      .map((c) => `${c}${c}`)
      .join('');
  }

  if (cleaned.length >= 6) {
    return cleaned.slice(0, 6);
  }

  return '000000';
}

function hexWithOpacity(hex: string, opacity: number): string {
  const base = normalizeHexColor(hex);
  const alpha = Math.round(Math.max(0, Math.min(1, opacity)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${base}${alpha}`;
}

export const CaptionOverlay = memo(function CaptionOverlay({
  containerWidth,
  containerHeight,
}: CaptionOverlayProps) {
  const captionSegments = useVideoEditorStore((s) => s.captionSegments);
  const captionSettings = useVideoEditorStore((s) => s.captionSettings);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const currentTimeSecs = currentTimeMs / 1000;

  // Use parity system for layout values (synced with Rust export)
  // Must be called before any early returns to respect React hooks rules
  const scaledLayout = useScaledLayout(containerHeight);

  // Find active caption segment
  const activeSegment = useMemo(() => {
    if (!captionSettings.enabled || captionSegments.length === 0) {
      return null;
    }
    return captionSegments.find(
      (s) => currentTimeSecs >= s.start && currentTimeSecs <= s.end
    ) || null;
  }, [captionSegments, captionSettings.enabled, currentTimeSecs]);

  // Find active word for highlighting
  const activeWordIndex = useMemo(() => {
    if (!activeSegment) return -1;
    return activeSegment.words.findIndex(
      (w) => currentTimeSecs >= w.start && currentTimeSecs <= w.end
    );
  }, [activeSegment, currentTimeSecs]);

  // Don't render if captions are disabled, no active segment, or layout not loaded
  if (!captionSettings.enabled || !activeSegment || !scaledLayout) {
    return null;
  }

  const {
    scale: scaleFactor,
    captionPadding: padding,
    captionBgPaddingH: bgPaddingH,
    captionBgPaddingV: bgPaddingV,
    captionCornerRadius: cornerRadius,
    lineHeightMultiplier
  } = scaledLayout;

  const fontSize = captionSettings.size * scaleFactor;
  const maxTextWidth = containerWidth - (padding * 2);

  // Calculate background color with opacity
  const bgColor = captionSettings.backgroundColor || '#000000';
  const bgOpacity = (captionSettings.backgroundOpacity || 0) / 100;
  const backgroundColor = bgOpacity > 0
    ? hexWithOpacity(bgColor, bgOpacity)
    : 'transparent';

  // Position style - calculate exact Y position to match Rust export
  // Rust calculates text_top position. CSS inner div has padding that offsets text.
  // So we position the BACKGROUND div and let CSS padding position the text.
  //
  // For bottom: background_bottom at (output_height - padding)
  //   → background_top = output_height - padding - line_height - bgPaddingV*2
  // For top: background_top at padding
  //   → background_top = padding
  const isTop = captionSettings.position === 'top';
  const lineHeight = fontSize * lineHeightMultiplier;

  // Calculate where background div top should be (text will be offset by bgPaddingV inside)
  const backgroundTop = isTop
    ? padding
    : containerHeight - padding - lineHeight - bgPaddingV * 2;

  const positionStyle: React.CSSProperties = { top: `${backgroundTop}px` };

  const captionText = getCaptionTextContent(activeSegment);

  // Render words with highlighting
  const renderText = () => {
    if (activeWordIndex < 0 || captionSettings.color === captionSettings.highlightColor) {
      // Match export: use words-joined content when words are present.
      return captionText;
    }

    // Render with word highlighting
    return activeSegment.words.map((word, idx) => (
      <span
        key={idx}
        style={{
          color: idx === activeWordIndex ? captionSettings.highlightColor : captionSettings.color,
          transition: 'color 0.15s ease',
        }}
      >
        {word.text}
        {idx < activeSegment.words.length - 1 ? ' ' : ''}
      </span>
    ));
  };

  // Export TextLayer uses parity padding values (16px H/V at 1080p, scaled by height).
  // Background wraps tightly around measured text size + padding.

  return (
    <div
      className="absolute left-0 right-0 flex justify-center pointer-events-none"
      style={{
        ...positionStyle,
        zIndex: 50,
      }}
    >
      <div
        style={{
          backgroundColor,
          // Match TextLayer: padding and corner radius scale with resolution
          padding: bgOpacity > 0 ? `${bgPaddingV}px ${bgPaddingH}px` : '0',
          borderRadius: bgOpacity > 0 ? `${cornerRadius}px` : '0',
          maxWidth: `${maxTextWidth}px`,
          textAlign: 'center',
        }}
      >
        <span
          style={{
            // Resolve font family names to match glyphon's family mapping.
            fontFamily: resolveCaptionFontFamily(captionSettings.font),
            fontSize: `${fontSize}px`,
            fontWeight: captionSettings.fontWeight || 700,
            fontStyle: captionSettings.italic ? 'italic' : 'normal',
            color: captionSettings.color,
            // Export caption path currently does not render text shadows.
            textShadow: 'none',
            lineHeight: lineHeightMultiplier, // From parity system - matches Rust export
          }}
        >
          {renderText()}
        </span>
      </div>
    </div>
  );
});

export default CaptionOverlay;
