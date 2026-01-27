/**
 * VideoEditorTimeline - Timeline section with integrated controls.
 * Wraps the VideoTimeline component with appropriate layout.
 */
import { VideoTimeline } from '../../components/VideoEditor/VideoTimeline';

export interface VideoEditorTimelineProps {
  onExport: () => void;
  onSplitAtPlayhead?: () => void;
  onResetTrimSegments?: () => void;
}

export function VideoEditorTimeline({ onExport, onSplitAtPlayhead, onResetTrimSegments }: VideoEditorTimelineProps) {
  return (
    <div className="h-80 flex flex-col">
      <VideoTimeline
        onExport={onExport}
        onSplitAtPlayhead={onSplitAtPlayhead}
        onResetTrimSegments={onResetTrimSegments}
      />
    </div>
  );
}
