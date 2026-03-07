import type { GifSettings, VideoSettings } from '@/types/generated';

export const RECORDING = {
  VIDEO_FPS_OPTIONS: [15, 30, 60],
  VIDEO_QUALITY_OPTIONS: [40, 60, 80, 100],
  COUNTDOWN_OPTIONS: [0, 3, 5],
  GIF_FPS_OPTIONS: [10, 15, 20, 30],
  GIF_MAX_DURATION_OPTIONS: [10, 30, 60, 0],
} as const;

function closestOption(value: number, options: readonly number[]): number {
  return options.reduce((closest, option) =>
    Math.abs(option - value) < Math.abs(closest - value) ? option : closest
  );
}

export function formatCountdownOption(seconds: number): string {
  return seconds === 0 ? 'Off' : `${seconds}s`;
}

export function formatGifDurationOption(seconds: number): string {
  return seconds === 0 ? 'Unlimited' : `${seconds}s`;
}

export function normalizeVideoSettings(settings: VideoSettings): VideoSettings {
  return {
    ...settings,
    fps: closestOption(settings.fps, RECORDING.VIDEO_FPS_OPTIONS),
    quality: closestOption(settings.quality, RECORDING.VIDEO_QUALITY_OPTIONS),
    countdownSecs: closestOption(settings.countdownSecs, RECORDING.COUNTDOWN_OPTIONS),
  };
}

export function normalizeGifSettings(settings: GifSettings): GifSettings {
  return {
    ...settings,
    fps: closestOption(settings.fps, RECORDING.GIF_FPS_OPTIONS),
    countdownSecs: closestOption(settings.countdownSecs, RECORDING.COUNTDOWN_OPTIONS),
    maxDurationSecs: settings.maxDurationSecs === 0
      ? 0
      : closestOption(settings.maxDurationSecs, RECORDING.GIF_MAX_DURATION_OPTIONS.filter((option) => option !== 0)),
  };
}

export function normalizeVideoSettingsUpdates(
  updates: Partial<VideoSettings>,
): Partial<VideoSettings> {
  const normalized = { ...updates };

  if (normalized.fps !== undefined) {
    normalized.fps = closestOption(normalized.fps, RECORDING.VIDEO_FPS_OPTIONS);
  }
  if (normalized.quality !== undefined) {
    normalized.quality = closestOption(normalized.quality, RECORDING.VIDEO_QUALITY_OPTIONS);
  }
  if (normalized.countdownSecs !== undefined) {
    normalized.countdownSecs = closestOption(
      normalized.countdownSecs,
      RECORDING.COUNTDOWN_OPTIONS,
    );
  }

  return normalized;
}

export function normalizeGifSettingsUpdates(
  updates: Partial<GifSettings>,
): Partial<GifSettings> {
  const normalized = { ...updates };

  if (normalized.fps !== undefined) {
    normalized.fps = closestOption(normalized.fps, RECORDING.GIF_FPS_OPTIONS);
  }
  if (normalized.countdownSecs !== undefined) {
    normalized.countdownSecs = closestOption(
      normalized.countdownSecs,
      RECORDING.COUNTDOWN_OPTIONS,
    );
  }
  if (normalized.maxDurationSecs !== undefined) {
    normalized.maxDurationSecs = normalized.maxDurationSecs === 0
      ? 0
      : closestOption(
          normalized.maxDurationSecs,
          RECORDING.GIF_MAX_DURATION_OPTIONS.filter((option) => option !== 0),
        );
  }

  return normalized;
}
