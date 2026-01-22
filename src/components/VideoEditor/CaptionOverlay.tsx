/**
 * CaptionOverlay - Renders transcribed captions on the video preview.
 *
 * Displays captions with configurable styling including background for readability.
 */
import { memo, useMemo } from 'react';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { usePreviewOrPlaybackTime } from '../../hooks/usePlaybackEngine';

interface CaptionOverlayProps {
  containerWidth: number;
  containerHeight: number;
  videoWidth: number;
  videoHeight: number;
}

export const CaptionOverlay = memo(function CaptionOverlay({
  containerWidth,
  containerHeight,
}: CaptionOverlayProps) {
  const captionSegments = useVideoEditorStore((s) => s.captionSegments);
  const captionSettings = useVideoEditorStore((s) => s.captionSettings);
  const currentTimeMs = usePreviewOrPlaybackTime();
  const currentTimeSecs = currentTimeMs / 1000;

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

  // Don't render if captions are disabled or no active segment
  if (!captionSettings.enabled || !activeSegment) {
    return null;
  }

  // Calculate background color with opacity
  const bgColor = captionSettings.backgroundColor || '#000000';
  const bgOpacity = (captionSettings.backgroundOpacity || 0) / 100;
  const backgroundColor = bgOpacity > 0
    ? `${bgColor}${Math.round(bgOpacity * 255).toString(16).padStart(2, '0')}`
    : 'transparent';

  // Scale factor based on container (reference 1080p)
  const scaleFactor = containerHeight / 1080;
  const fontSize = captionSettings.size * scaleFactor;

  // Match export padding: 40px at 1080p
  const padding = 40 * scaleFactor;

  // Match export: text_width = output_width - (padding * 2)
  const maxTextWidth = containerWidth - (padding * 2);

  // Position style - use absolute pixels like export
  const isTop = captionSettings.position === 'top';
  const positionStyle: React.CSSProperties = isTop
    ? { top: `${padding}px` }
    : { bottom: `${padding}px` };

  // Scale padding and corner radius with resolution (reference 1080p)
  // These must match text_layer.rs values
  const bgPaddingV = 8 * scaleFactor;
  const bgPaddingH = 16 * scaleFactor;
  // Use larger corner radius (12px base) for more visible rounded corners
  const cornerRadius = 12 * scaleFactor;

  // Render words with highlighting
  const renderText = () => {
    if (activeWordIndex < 0 || captionSettings.color === captionSettings.highlightColor) {
      // No word-level highlighting, render plain text
      return activeSegment.text;
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

  // Export TextLayer uses: padding_h = 16px, padding_v = 8px (fixed, not scaled)
  // Background wraps tightly around measured text size + padding

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
            // Use system-ui which matches glyphon's SansSerif on most platforms
            fontFamily: captionSettings.font || 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: `${fontSize}px`,
            fontWeight: captionSettings.fontWeight || 700,
            fontStyle: captionSettings.italic ? 'italic' : 'normal',
            color: captionSettings.color,
            textShadow: bgOpacity === 0
              ? '2px 2px 4px rgba(0,0,0,0.8), -1px -1px 2px rgba(0,0,0,0.5)'
              : 'none',
            lineHeight: 1.2, // Match glyphon: Metrics::new(font_size, font_size * 1.2)
          }}
        >
          {renderText()}
        </span>
      </div>
    </div>
  );
});

export default CaptionOverlay;
