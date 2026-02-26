interface RecordingDimensionsLike {
  width?: number;
  height?: number;
}

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Resolve recording dimensions with safe fallback to source video dimensions.
 */
export function resolveRecordingDimensions(
  recording: RecordingDimensionsLike | null | undefined,
  fallbackWidth: number,
  fallbackHeight: number
): Dimensions {
  const width =
    typeof recording?.width === 'number' && recording.width > 0
      ? recording.width
      : fallbackWidth;
  const height =
    typeof recording?.height === 'number' && recording.height > 0
      ? recording.height
      : fallbackHeight;

  return { width, height };
}
