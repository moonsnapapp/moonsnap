import { useCallback } from 'react';
import type { SharedBackgroundType } from '@/components/shared/background/BackgroundTypeTabs';
import {
  BACKGROUND_DEFAULT_PADDING,
  BACKGROUND_DEFAULT_ROUNDING,
  getEnableFrameDefaultDecision,
  getTypeSwitchFrameDefaultDecision,
} from '@/utils/backgroundDefaults';

export interface GradientPreset {
  start: string;
  end: string;
  angle: number;
}

interface BackgroundKeys<T> {
  type: keyof T;
  padding: keyof T;
  rounding: keyof T;
  enabled?: keyof T;
  gradientStart: keyof T;
  gradientEnd: keyof T;
  gradientAngle: keyof T;
}

interface UseBackgroundSettingsControllerOptions<T, TType extends SharedBackgroundType> {
  type: TType;
  padding: number;
  rounding: number;
  enabled?: boolean;
  keys: BackgroundKeys<T>;
  onPatch: (patch: Partial<T>) => void;
}

function buildPatch<T>(
  entries: Array<[keyof T, unknown]>
): Partial<T> {
  const patch: Partial<T> = {};
  entries.forEach(([key, value]) => {
    (patch as Record<string, unknown>)[String(key)] = value;
  });
  return patch;
}

export function useBackgroundSettingsController<
  T,
  TType extends SharedBackgroundType
>(options: UseBackgroundSettingsControllerOptions<T, TType>) {
  const { type, padding, rounding, enabled, keys, onPatch } = options;

  const handleTypeChange = useCallback(
    (nextType: TType) => {
      const defaults = getTypeSwitchFrameDefaultDecision(nextType, padding, rounding);
      const entries: Array<[keyof T, unknown]> = [[keys.type, nextType]];

      if (defaults.applyPadding) {
        entries.push([keys.padding, BACKGROUND_DEFAULT_PADDING]);
      }
      if (defaults.applyRounding) {
        entries.push([keys.rounding, BACKGROUND_DEFAULT_ROUNDING]);
      }

      onPatch(buildPatch(entries));
    },
    [keys.padding, keys.rounding, keys.type, onPatch, padding, rounding]
  );

  const handleGradientPreset = useCallback(
    (preset: GradientPreset) => {
      onPatch(
        buildPatch<T>([
          [keys.type, 'gradient'],
          [keys.gradientStart, preset.start],
          [keys.gradientEnd, preset.end],
          [keys.gradientAngle, preset.angle],
        ])
      );
    },
    [keys.gradientAngle, keys.gradientEnd, keys.gradientStart, keys.type, onPatch]
  );

  const handleToggleEnabled = useCallback(() => {
    if (!keys.enabled || enabled === undefined) return;

    const turningOn = !enabled;
    const defaults = getEnableFrameDefaultDecision(turningOn, padding, rounding);
    const entries: Array<[keyof T, unknown]> = [[keys.enabled, turningOn]];

    if (defaults.applyPadding) {
      entries.push([keys.padding, BACKGROUND_DEFAULT_PADDING]);
    }
    if (defaults.applyRounding) {
      entries.push([keys.rounding, BACKGROUND_DEFAULT_ROUNDING]);
    }

    onPatch(buildPatch(entries));
  }, [enabled, keys.enabled, keys.padding, keys.rounding, onPatch, padding, rounding]);

  return {
    type,
    handleTypeChange,
    handleGradientPreset,
    handleToggleEnabled: keys.enabled ? handleToggleEnabled : undefined,
  };
}
