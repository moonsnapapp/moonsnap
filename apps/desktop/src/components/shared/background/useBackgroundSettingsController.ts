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

interface FrameDefaultDecision {
  applyPadding: boolean;
  applyRounding: boolean;
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

function appendFrameDefaults<T>(
  entries: Array<[keyof T, unknown]>,
  keys: Pick<BackgroundKeys<T>, 'padding' | 'rounding'>,
  defaults: FrameDefaultDecision
) {
  if (defaults.applyPadding) {
    entries.push([keys.padding, BACKGROUND_DEFAULT_PADDING]);
  }
  if (defaults.applyRounding) {
    entries.push([keys.rounding, BACKGROUND_DEFAULT_ROUNDING]);
  }
}

function buildTypeChangePatch<T, TType extends SharedBackgroundType>(
  nextType: TType,
  typeKey: keyof T,
  frameKeys: Pick<BackgroundKeys<T>, 'padding' | 'rounding'>,
  padding: number,
  rounding: number
) {
  const defaults = getTypeSwitchFrameDefaultDecision(nextType, padding, rounding);
  const entries: Array<[keyof T, unknown]> = [[typeKey, nextType]];

  appendFrameDefaults(entries, frameKeys, defaults);
  return buildPatch(entries);
}

function buildToggleEnabledPatch<T>(
  enabledKey: keyof T,
  frameKeys: Pick<BackgroundKeys<T>, 'padding' | 'rounding'>,
  turningOn: boolean,
  padding: number,
  rounding: number
) {
  const defaults = getEnableFrameDefaultDecision(turningOn, padding, rounding);
  const entries: Array<[keyof T, unknown]> = [[enabledKey, turningOn]];

  appendFrameDefaults(entries, frameKeys, defaults);
  return buildPatch(entries);
}

export function useBackgroundSettingsController<
  T,
  TType extends SharedBackgroundType
>(options: UseBackgroundSettingsControllerOptions<T, TType>) {
  const { type, padding, rounding, enabled, keys, onPatch } = options;

  const handleTypeChange = useCallback(
    (nextType: TType) => {
      onPatch(
        buildTypeChangePatch(
          nextType,
          keys.type,
          { padding: keys.padding, rounding: keys.rounding },
          padding,
          rounding
        )
      );
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
    onPatch(
      buildToggleEnabledPatch(
        keys.enabled,
        { padding: keys.padding, rounding: keys.rounding },
        turningOn,
        padding,
        rounding
      )
    );
  }, [enabled, keys.enabled, keys.padding, keys.rounding, onPatch, padding, rounding]);

  return {
    type,
    handleTypeChange,
    handleGradientPreset,
    handleToggleEnabled: keys.enabled ? handleToggleEnabled : undefined,
  };
}
