/**
 * VideoEditorTimeline - Timeline section with integrated controls.
 * Wraps the VideoTimeline component with appropriate layout.
 */
import { VideoTimeline } from '../../components/VideoEditor/VideoTimeline';

export interface VideoEditorTimelineProps {
  onExport: () => void;
  onSplitAtPlayhead?: () => void;
}

export function VideoEditorTimeline({ onExport, onSplitAtPlayhead }: VideoEditorTimelineProps) {
  return (
    <div className="h-80 flex flex-col">
      <VideoTimeline onExport={onExport} onSplitAtPlayhead={onSplitAtPlayhead} />
    </div>
  );
}
