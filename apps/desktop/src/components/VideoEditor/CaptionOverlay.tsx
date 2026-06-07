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
import { usePreviewOrPlaybackTimeThrottled } from '../../hooks/usePlaybackTimeThrottled';
import { useScaledLayout } from '@/hooks/useParityLayout';
import { remapCaptionSegmentsToTimeline } from '@/utils/captionTimeline';
import type { CaptionSettings } from '../../types';

interface CaptionOverlayProps {
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
}

type TimelineCaptionSegment = ReturnType<typeof remapCaptionSegmentsToTimeline>[number];
type ScaledCaptionLayout = NonNullable<ReturnType<typeof useScaledLayout>>;

const SYSTEM_SANS_STACK = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const SANS_FONT_ALIASES = new Set([
  '',
  'sans',
  'sans-serif',
  'system sans',
  'system sans-serif',
  'system-ui',
]);
const SERIF_FONT_ALIASES = new Set(['serif', 'system serif']);
const MONO_FONT_ALIASES = new Set([
  'mono',
  'monospace',
  'system mono',
  'system monospace',
]);
const CAPTION_FONT_ALIAS_GROUPS = [
  { aliases: SANS_FONT_ALIASES, family: SYSTEM_SANS_STACK },
  { aliases: SERIF_FONT_ALIASES, family: 'serif' },
  { aliases: MONO_FONT_ALIASES, family: 'monospace' },
];

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
  const aliasGroup = CAPTION_FONT_ALIAS_GROUPS.find(({ aliases }) => aliases.has(normalized));

  return aliasGroup?.family ?? `${font}, ${SYSTEM_SANS_STACK}`;
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

function isTimeWithinWord(word: { start: number; end: number }, currentTimeSecs: number): boolean {
  return currentTimeSecs >= word.start && currentTimeSecs <= word.end;
}

function getDistanceFromWord(word: { start: number; end: number }, currentTimeSecs: number): number {
  if (currentTimeSecs < word.start) {
    return word.start - currentTimeSecs;
  }

  return currentTimeSecs - word.end;
}

function getTransitionHighlightFactor(distance: number, duration: number): number {
  return distance < duration ? 1 - distance / duration : 0;
}

function calculateWordHighlightFactor(
  word: { start: number; end: number },
  currentTimeSecs: number,
  transitionDuration: number
): number {
  if (isTimeWithinWord(word, currentTimeSecs)) {
    return 1;
  }

  const duration = Math.max(0, transitionDuration);
  if (duration === 0) {
    return 0;
  }

  return getTransitionHighlightFactor(getDistanceFromWord(word, currentTimeSecs), duration);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getSegmentVisibleEnd(
  segment: { end: number },
  lingerDuration: number
): number {
  return segment.end + Math.max(0, lingerDuration);
}

function isTimeWithinSegmentWindow(
  segment: { start: number },
  currentTimeSecs: number,
  visibleEnd: number
): boolean {
  return currentTimeSecs >= segment.start && currentTimeSecs <= visibleEnd;
}

function getSegmentFadeOpacity({
  fade,
  visibleDuration,
  timeSinceStart,
  timeUntilEnd,
}: {
  fade: number;
  visibleDuration: number;
  timeSinceStart: number;
  timeUntilEnd: number;
}): number {
  const canFadeOut = visibleDuration > fade * 2;
  if (timeSinceStart < fade) {
    return clampUnit(timeSinceStart / fade);
  }

  return canFadeOut && timeUntilEnd < fade ? clampUnit(timeUntilEnd / fade) : 1;
}

function calculateSegmentOpacity(
  segment: { start: number; end: number },
  currentTimeSecs: number,
  fadeDuration: number,
  lingerDuration: number
): number {
  const visibleEnd = getSegmentVisibleEnd(segment, lingerDuration);
  if (!isTimeWithinSegmentWindow(segment, currentTimeSecs, visibleEnd)) {
    return 0;
  }

  const fade = Math.max(0, fadeDuration);
  if (fade === 0) {
    return 1;
  }

  const visibleDuration = visibleEnd - segment.start;
  const timeSinceStart = currentTimeSecs - segment.start;
  const timeUntilEnd = visibleEnd - currentTimeSecs;

  return getSegmentFadeOpacity({ fade, visibleDuration, timeSinceStart, timeUntilEnd });
}

function getActiveCaptionSegment({
  enabled,
  segments,
  currentTimeSecs,
  lingerDuration,
}: {
  enabled: boolean;
  segments: ReturnType<typeof remapCaptionSegmentsToTimeline>;
  currentTimeSecs: number;
  lingerDuration: number | undefined;
}) {
  if (!canFindActiveCaptionSegment(enabled, segments)) return null;

  const linger = getNormalizedLingerDuration(lingerDuration);
  return segments.find((segment) => isCaptionSegmentActive(segment, currentTimeSecs, linger)) || null;
}

function canFindActiveCaptionSegment(
  enabled: boolean,
  segments: ReturnType<typeof remapCaptionSegmentsToTimeline>,
) {
  return enabled && segments.length > 0;
}

function getNormalizedLingerDuration(lingerDuration: number | undefined) {
  return Math.max(0, lingerDuration || 0);
}

function isCaptionSegmentActive(
  segment: TimelineCaptionSegment,
  currentTimeSecs: number,
  linger: number,
) {
  return currentTimeSecs >= segment.start && currentTimeSecs <= segment.end + linger;
}

function getCaptionBackgroundColor(color: string | undefined, opacityPercent: number | undefined) {
  const opacity = (opacityPercent || 0) / 100;
  return opacity > 0 ? hexWithOpacity(color || '#000000', opacity) : 'transparent';
}

function getCaptionBackgroundTop({
  position,
  padding,
  containerHeight,
  lineHeight,
  bgPaddingV,
}: {
  position: string;
  padding: number;
  containerHeight: number;
  lineHeight: number;
  bgPaddingV: number;
}) {
  return position === 'top'
    ? padding
    : containerHeight - padding - lineHeight - bgPaddingV * 2;
}

function renderCaptionText({
  captionText,
  words,
  currentTimeSecs,
  color,
  highlightColor,
  wordTransitionDuration,
}: {
  captionText: string;
  words: Array<{ text: string; start: number; end: number }>;
  currentTimeSecs: number;
  color: string;
  highlightColor: string;
  wordTransitionDuration: number;
}) {
  if (color === highlightColor || words.length === 0) return captionText;

  const baseRgb = hexToRgb(color);
  const highlightRgb = hexToRgb(highlightColor);
  return words.map((word, idx) => (
    <span
      key={idx}
      style={{
        color: blendRgb(
          baseRgb,
          highlightRgb,
          calculateWordHighlightFactor(word, currentTimeSecs, wordTransitionDuration)
        ),
      }}
    >
      {word.text}
      {idx < words.length - 1 ? ' ' : ''}
    </span>
  ));
}

function getCaptionOverlayLayout({
  containerWidth,
  containerHeight,
  captionSettings,
  scaledLayout,
}: {
  containerWidth: number;
  containerHeight: number;
  captionSettings: CaptionSettings;
  scaledLayout: ScaledCaptionLayout;
}) {
  const {
    scale: scaleFactor,
    captionPadding: padding,
    captionBgPaddingH: bgPaddingH,
    captionBgPaddingV: bgPaddingV,
    captionCornerRadius: cornerRadius,
    lineHeightMultiplier,
  } = scaledLayout;
  const fontSize = captionSettings.size * scaleFactor;
  const lineHeight = fontSize * lineHeightMultiplier;

  return {
    fontSize,
    bgPaddingH,
    bgPaddingV,
    cornerRadius,
    lineHeightMultiplier,
    maxTextWidth: containerWidth - (padding * 2),
    backgroundTop: getCaptionBackgroundTop({
      position: captionSettings.position,
      padding,
      containerHeight,
      lineHeight,
      bgPaddingV,
    }),
  };
}

function getCaptionShellStyle(
  backgroundTop: number,
  segmentOpacity: number
): React.CSSProperties {
  return {
    top: `${backgroundTop}px`,
    zIndex: 50,
    opacity: segmentOpacity,
  };
}

function getCaptionBackgroundStyle({
  backgroundColor,
  backgroundOpacity,
  bgPaddingH,
  bgPaddingV,
  cornerRadius,
  maxTextWidth,
}: {
  backgroundColor: string;
  backgroundOpacity: number | undefined;
  bgPaddingH: number;
  bgPaddingV: number;
  cornerRadius: number;
  maxTextWidth: number;
}): React.CSSProperties {
  const hasBackground = (backgroundOpacity || 0) > 0;

  return {
    backgroundColor,
    padding: hasBackground ? `${bgPaddingV}px ${bgPaddingH}px` : '0',
    borderRadius: hasBackground ? `${cornerRadius}px` : '0',
    maxWidth: `${maxTextWidth}px`,
    textAlign: 'center',
  };
}

function getCaptionTextStyle({
  captionSettings,
  fontSize,
  lineHeightMultiplier,
}: {
  captionSettings: CaptionSettings;
  fontSize: number;
  lineHeightMultiplier: number;
}): React.CSSProperties {
  return {
    fontFamily: resolveCaptionFontFamily(captionSettings.font),
    fontSize: `${fontSize}px`,
    fontWeight: captionSettings.fontWeight || 700,
    fontStyle: captionSettings.italic ? 'italic' : 'normal',
    color: captionSettings.color,
    textShadow: 'none',
    lineHeight: lineHeightMultiplier,
  };
}

function CaptionOverlayContent({
  activeSegment,
  segmentOpacity,
  captionSettings,
  scaledLayout,
  containerWidth,
  containerHeight,
  currentTimeSecs,
}: {
  activeSegment: TimelineCaptionSegment;
  segmentOpacity: number;
  captionSettings: CaptionSettings;
  scaledLayout: ScaledCaptionLayout;
  containerWidth: number;
  containerHeight: number;
  currentTimeSecs: number;
}) {
  const overlayLayout = getCaptionOverlayLayout({
    containerWidth,
    containerHeight,
    captionSettings,
    scaledLayout,
  });
  const captionText = getCaptionTextContent(activeSegment);
  const renderedText = renderCaptionText({
    captionText,
    words: activeSegment.words,
    currentTimeSecs,
    color: captionSettings.color,
    highlightColor: captionSettings.highlightColor,
    wordTransitionDuration: captionSettings.wordTransitionDuration,
  });
  const backgroundColor = getCaptionBackgroundColor(
    captionSettings.backgroundColor,
    captionSettings.backgroundOpacity
  );

  return (
    <div
      className="absolute left-0 right-0 flex justify-center pointer-events-none"
      style={getCaptionShellStyle(overlayLayout.backgroundTop, segmentOpacity)}
    >
      <div
        style={getCaptionBackgroundStyle({
          backgroundColor,
          backgroundOpacity: captionSettings.backgroundOpacity,
          bgPaddingH: overlayLayout.bgPaddingH,
          bgPaddingV: overlayLayout.bgPaddingV,
          cornerRadius: overlayLayout.cornerRadius,
          maxTextWidth: overlayLayout.maxTextWidth,
        })}
      >
        <span
          style={getCaptionTextStyle({
            captionSettings,
            fontSize: overlayLayout.fontSize,
            lineHeightMultiplier: overlayLayout.lineHeightMultiplier,
          })}
        >
          {renderedText}
        </span>
      </div>
    </div>
  );
}

function useActiveCaptionOverlayState({
  captionSettings,
  timelineCaptionSegments,
  currentTimeSecs,
  scaledLayout,
}: {
  captionSettings: CaptionSettings;
  timelineCaptionSegments: ReturnType<typeof remapCaptionSegmentsToTimeline>;
  currentTimeSecs: number;
  scaledLayout: ScaledCaptionLayout | null;
}) {
  const activeSegment = useMemo(() => getActiveCaptionSegment({
    enabled: captionSettings.enabled,
    segments: timelineCaptionSegments,
    currentTimeSecs,
    lingerDuration: captionSettings.lingerDuration,
  }), [
    captionSettings.enabled,
    captionSettings.lingerDuration,
    currentTimeSecs,
    timelineCaptionSegments,
  ]);

  const segmentOpacity = activeSegment
    ? calculateSegmentOpacity(
      activeSegment,
      currentTimeSecs,
      captionSettings.fadeDuration,
      captionSettings.lingerDuration
    )
    : 0;

  return {
    activeSegment,
    segmentOpacity,
    canRender: canRenderCaptionOverlay({
      enabled: captionSettings.enabled,
      activeSegment,
      scaledLayout,
      segmentOpacity,
    }),
  };
}

function canRenderCaptionOverlay({
  enabled,
  activeSegment,
  scaledLayout,
  segmentOpacity,
}: {
  enabled: boolean;
  activeSegment: TimelineCaptionSegment | null;
  scaledLayout: ScaledCaptionLayout | null;
  segmentOpacity: number;
}) {
  return [
    enabled,
    activeSegment !== null,
    scaledLayout !== null,
    segmentOpacity > 0.001,
  ].every(Boolean);
}

export const CaptionOverlay = memo(function CaptionOverlay({
  containerWidth,
  containerHeight,
}: CaptionOverlayProps) {
  const captionSegments = useVideoEditorStore(selectCaptionSegments);
  const captionSettings = useVideoEditorStore(selectCaptionSettings);
  const timelineSegments = useVideoEditorStore(selectTimelineSegments);
  const currentTimeMs = usePreviewOrPlaybackTimeThrottled(10);
  const currentTimeSecs = currentTimeMs / 1000;
  const timelineCaptionSegments = useMemo(
    () => remapCaptionSegmentsToTimeline(captionSegments, timelineSegments),
    [captionSegments, timelineSegments]
  );

  const scaledLayout = useScaledLayout(containerHeight);

  const { activeSegment, segmentOpacity, canRender } = useActiveCaptionOverlayState({
    captionSettings,
    timelineCaptionSegments,
    currentTimeSecs,
    scaledLayout,
  });

  if (!canRender || !activeSegment || !scaledLayout) {
    return null;
  }

  return (
    <CaptionOverlayContent
      activeSegment={activeSegment}
      segmentOpacity={segmentOpacity}
      captionSettings={captionSettings}
      scaledLayout={scaledLayout}
      containerWidth={containerWidth}
      containerHeight={containerHeight}
      currentTimeSecs={currentTimeSecs}
    />
  );
});

export default CaptionOverlay;
