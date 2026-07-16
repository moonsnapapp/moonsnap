import type { RefObject } from 'react';

import { clamp, MIN_SEGMENT_DURATION_SECONDS } from '../../../utils/captionTiming';

interface CaptionTimelineScrubbingOptions {
  playbackTimelineRef: RefObject<HTMLDivElement | null>;
  localTimelineRef: RefObject<HTMLDivElement | null>;
  projectDurationSeconds: number;
  editingStartSeconds: string;
  editingEndSeconds: string;
  requestSeek: (timeMs: number) => void;
}

export function useCaptionTimelineScrubbing({
  playbackTimelineRef,
  localTimelineRef,
  projectDurationSeconds,
  editingStartSeconds,
  editingEndSeconds,
  requestSeek,
}: CaptionTimelineScrubbingOptions) {
  const seekFromPlaybackTimeline = (clientX: number) => {
    const rect = playbackTimelineRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    requestSeek(ratio * projectDurationSeconds * 1000);
  };

  const seekFromLocalTimeline = (clientX: number) => {
    const rect = localTimelineRef.current?.getBoundingClientRect();
    if (!rect) return;

    const parsedStartSeconds = Number.parseFloat(editingStartSeconds);
    const parsedEndSeconds = Number.parseFloat(editingEndSeconds);
    if (!Number.isFinite(parsedStartSeconds) || !Number.isFinite(parsedEndSeconds)) return;

    const segmentStartSeconds = Math.max(0, parsedStartSeconds);
    const segmentEndSeconds = Math.max(
      segmentStartSeconds + MIN_SEGMENT_DURATION_SECONDS,
      parsedEndSeconds
    );
    const segmentDurationSeconds = Math.max(
      segmentEndSeconds - segmentStartSeconds,
      MIN_SEGMENT_DURATION_SECONDS
    );
    const ratio = clamp((clientX - rect.left) / Math.max(rect.width, 1), 0, 1);
    requestSeek((segmentStartSeconds + ratio * segmentDurationSeconds) * 1000);
  };

  const beginPlaybackScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    seekFromPlaybackTimeline(event.clientX);

    const handleMove = (moveEvent: MouseEvent) => {
      seekFromPlaybackTimeline(moveEvent.clientX);
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  };

  const beginLocalTimelineScrub = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    seekFromLocalTimeline(event.clientX);

    const handleMove = (moveEvent: MouseEvent) => {
      seekFromLocalTimeline(moveEvent.clientX);
    };
    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'ew-resize';
  };

  return { beginPlaybackScrub, beginLocalTimelineScrub };
}
