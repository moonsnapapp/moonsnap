/**
 * CaptionOverlay - Renders transcribed captions on the video preview.
 *
 * Displays captions with configurable styling including background for readability.
 */
import { memo, useMemo } from 'react';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import {
  selectCaptionSegments,
  selectCaptionSettings,
  selectTimelineSegments,
} from '../../stores/videoEditor/selectors';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';
import { useScaledLayout } from '@/hooks/useParityLayout';
import { remapCaptionSegmentsToTimeline } from '@/utils/captionTimeline';

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

function hexToRgb(hex: string): [number, number, number] {
  const normalized = normalizeHexColor(hex);
  return [
    Number.parseInt(normalized.slice(0, 2), 16),
    Number.parseInt(normalized.slice(2, 4), 16),
    Number.parseInt(normalized.slice(4, 6), 16),
  ];
}

function blendRgb(
  base: [number, number, number],
  highlight: [number, number, number],
  factor: number
): string {
  const t = Math.max(0, Math.min(1, factor));
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${mix(base[0], highlight[0])}, ${mix(base[1], highlight[1])}, ${mix(base[2], highlight[2])})`;
}

function calculateWordHighlightFactor(
  word: { start: number; end: number },
  currentTimeSecs: number,
  transitionDuration: number
): number {
  const duration = Math.max(0, transitionDuration);
  if (duration === 0) {
    return currentTimeSecs >= word.start && currentTimeSecs <= word.end ? 1 : 0;
  }

  if (currentTimeSecs >= word.start && currentTimeSecs <= word.end) {
    return 1;
  }

  if (currentTimeSecs < word.start) {
    const distance = word.start - currentTimeSecs;
    return distance < duration ? 1 - distance / duration : 0;
  }

  const distance = currentTimeSecs - word.end;
  return distance < duration ? 1 - distance / duration : 0;
}

function calculateSegmentOpacity(
  segment: { start: number; end: number },
  currentTimeSecs: number,
  fadeDuration: number,
  lingerDuration: number
): number {
  const linger = Math.max(0, lingerDuration);
  const visibleEnd = segment.end + linger;
  if (currentTimeSecs < segment.start || currentTimeSecs > visibleEnd) {
    return 0;
  }

  const fade = Math.max(0, fadeDuration);
  if (fade === 0) {
    return 1;
  }

  const visibleDuration = visibleEnd - segment.start;
  const timeSinceStart = currentTimeSecs - segment.start;
  const timeUntilEnd = visibleEnd - currentTimeSecs;

  if (timeSinceStart < fade) {
    return Math.max(0, Math.min(1, timeSinceStart / fade));
  }

  if (timeUntilEnd < fade && visibleDuration > fade * 2) {
    return Math.max(0, Math.min(1, timeUntilEnd / fade));
  }

  return 1;
}

export const CaptionOverlay = memo(function CaptionOverlay({
  containerWidth,
  containerHeight,
}: CaptionOverlayProps) {
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const timelineSegments = useVideoEditorStore(selectTimelineSegments);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const currentTimeSecs = currentTimeMs / 1000;
  const timelineCaptionSegments = useMemo(
    () => remapCaptionSegmentsToTimeline(captionSegments, timelineSegments),
    [captionSegments, timelineSegments]
  );

  // Use parity system for layout values (synced with Rust export)
  // Must be called before any early returns to respect React hooks rules
  const scaledLayout = useScaledLayout(containerHeight);

  // Find active caption segment
  const activeSegment = useMemo(() => {
    if (!captionSettings.enabled || timelineCaptionSegments.length === 0) {
      return null;
    }
    const lingerDuration = Math.max(0, captionSettings.lingerDuration || 0);
    return timelineCaptionSegments.find(
      (s) => currentTimeSecs >= s.start && currentTimeSecs <= s.end + lingerDuration
    ) || null;
  }, [
    captionSettings.enabled,
    captionSettings.lingerDuration,
    currentTimeSecs,
    timelineCaptionSegments,
  ]);

  // Don't render if captions are disabled, no active segment, or layout not loaded
  if (!captionSettings.enabled || !activeSegment || !scaledLayout) {
    return null;
  }

  const segmentOpacity = calculateSegmentOpacity(
    activeSegment,
    currentTimeSecs,
    captionSettings.fadeDuration,
    captionSettings.lingerDuration
  );
  if (segmentOpacity <= 0.001) {
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
    if (
      captionSettings.color === captionSettings.highlightColor ||
      activeSegment.words.length === 0
    ) {
      // Match export: use words-joined content when words are present.
      return captionText;
    }

    const baseRgb = hexToRgb(captionSettings.color);
    const highlightRgb = hexToRgb(captionSettings.highlightColor);

    // Render with word highlighting
    return activeSegment.words.map((word, idx) => (
      <span
        key={idx}
        style={{
          color: blendRgb(
            baseRgb,
            highlightRgb,
            calculateWordHighlightFactor(
              word,
              currentTimeSecs,
              captionSettings.wordTransitionDuration
            )
          ),
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
        opacity: segmentOpacity,
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
