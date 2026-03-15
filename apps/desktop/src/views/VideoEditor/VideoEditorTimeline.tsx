/**
 * VideoEditorTimeline - Timeline section with integrated controls.
 * Wraps the VideoTimeline component with appropriate layout.
 */
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { selectProject, selectTrackVisibility } from '../../stores/videoEditor/selectors';
import { VideoTimeline } from '../../components/VideoEditor/VideoTimeline';

export interface VideoEditorTimelineProps {
  onExport: () => void;
  onResetTrimSegments?: () => void;
  onSetInPoint?: () => void;
  onSetOutPoint?: () => void;
  onClearExportRange?: () => void;
}

const TIMELINE_HEADER_HEIGHT_PX = 44;
const TIMELINE_RULER_HEIGHT_PX = 32;
const TIMELINE_TRACK_HEIGHT_PX = 48;
const TIMELINE_SCROLLBAR_ALLOWANCE_PX = 14;
const TIMELINE_BASE_HEIGHT_PX = 320;

export function VideoEditorTimeline({ onExport, onResetTrimSegments, onSetInPoint, onSetOutPoint, onClearExportRange }: VideoEditorTimelineProps) {
  const project = useVideoEditorStore(selectProject);
  const trackVisibility = useVideoEditorStore(selectTrackVisibility);

  let visibleTrackCount = 0;
  if (trackVisibility.video) visibleTrackCount += 1;
  if (project && trackVisibility.text) visibleTrackCount += 1;
  if (project && trackVisibility.annotation) visibleTrackCount += 1;
  if (project && trackVisibility.zoom) visibleTrackCount += 1;
  if (project && trackVisibility.scene && project.sources.webcamVideo) visibleTrackCount += 1;
  if (project && trackVisibility.mask) visibleTrackCount += 1;

  const timelineHeight = Math.max(
    TIMELINE_BASE_HEIGHT_PX,
    TIMELINE_HEADER_HEIGHT_PX +
      TIMELINE_RULER_HEIGHT_PX +
      visibleTrackCount * TIMELINE_TRACK_HEIGHT_PX +
      TIMELINE_SCROLLBAR_ALLOWANCE_PX
  );

  return (
    <div className="timeline-shell flex flex-col" style={{ height: `${timelineHeight}px` }}>
      <VideoTimeline
        onExport={onExport}
        onResetTrimSegments={onResetTrimSegments}
        onSetInPoint={onSetInPoint}
        onSetOutPoint={onSetOutPoint}
        onClearExportRange={onClearExportRange}
      />
    </div>
  );
}
