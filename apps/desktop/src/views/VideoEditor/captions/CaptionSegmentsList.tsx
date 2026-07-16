import type { CaptionSegment } from '../../../types';
import { formatTime } from '../../../utils/captionTiming';

const DEFAULT_VISIBLE_SEGMENTS = 20;

export interface CaptionSegmentsListProps {
  segments: CaptionSegment[];
  visibleSegments: CaptionSegment[];
  showAllSegments: boolean;
  onToggleShowAllSegments: () => void;
  onOpenEditor: () => void;
}
export function CaptionSegmentsList({
  segments,
  visibleSegments,
  showAllSegments,
  onToggleShowAllSegments,
  onOpenEditor,
}: CaptionSegmentsListProps) {
  if (segments.length === 0) return null;

  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
          Segments ({segments.length})
        </span>
        <button
          type="button"
          onClick={onOpenEditor}
          className="editor-choice-pill editor-choice-pill--active px-2 py-1 text-[10px]"
        >
          Open Editor
        </button>
      </div>
      <div className="max-h-48 overflow-y-auto space-y-1">
        {visibleSegments.map((segment) => (
          <div
            key={segment.id}
            className="px-2 py-1.5 bg-[var(--polar-mist)] rounded text-xs"
          >
            <div className="mb-0.5 text-[var(--ink-subtle)] font-mono">
              {formatTime(segment.start)} - {formatTime(segment.end)}
            </div>
            <p className="text-[var(--ink-dark)] break-words line-clamp-2">
              {segment.text}
            </p>
          </div>
        ))}
      </div>
      {segments.length > DEFAULT_VISIBLE_SEGMENTS && (
        <button
          onClick={onToggleShowAllSegments}
          className="mt-2 w-full px-2 py-1.5 rounded text-xs text-[var(--ink-subtle)] hover:text-[var(--ink-dark)] hover:bg-[var(--polar-mist)] transition-colors"
        >
          {showAllSegments
            ? `Show fewer (first ${DEFAULT_VISIBLE_SEGMENTS})`
            : `Show all ${segments.length} segments`}
        </button>
      )}
    </div>
  );
}
