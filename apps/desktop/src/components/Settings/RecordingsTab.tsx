import React from 'react';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RECORDING, formatCountdownOption, formatGifDurationOption } from '@/constants';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';

interface OptionToggleGroupProps {
  ariaLabel: string;
  value: number;
  options: readonly number[];
  formatLabel: (value: number) => string;
  onChange: (value: number) => void;
}

const TOGGLE_GROUP_CLASS =
  'justify-start flex-wrap gap-2';

const TOGGLE_GROUP_ITEM_CLASS =
  'h-8 px-3 text-xs border border-[var(--polar-frost)] bg-[var(--card)] text-[var(--ink-black)] hover:bg-[var(--polar-ice)] data-[state=on]:bg-[var(--polar-frost)] data-[state=on]:text-[var(--ink-black)]';

const OptionToggleGroup: React.FC<OptionToggleGroupProps> = ({
  ariaLabel,
  value,
  options,
  formatLabel,
  onChange,
}) => {
  const currentValue = options.includes(value) ? String(value) : undefined;

  return (
    <ToggleGroup
      type="single"
      value={currentValue}
      onValueChange={(nextValue) => {
        if (!nextValue) return;
        onChange(parseInt(nextValue, 10));
      }}
      className={TOGGLE_GROUP_CLASS}
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option}
          value={String(option)}
          variant="outline"
          size="sm"
          className={TOGGLE_GROUP_ITEM_CLASS}
          aria-label={formatLabel(option)}
        >
          {formatLabel(option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};

export const RecordingsTab: React.FC = () => {
  const {
    settings,
    updateVideoSettings,
    updateGifSettings,
    afterRecordingAction,
    setAfterRecordingAction,
    promptRecordingMode,
    setPromptRecordingMode,
  } = useCaptureSettingsStore();
  const { video, gif } = settings;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Behavior
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              After recording
            </label>
            <Select
              value={afterRecordingAction}
              onValueChange={(value) => setAfterRecordingAction(value as AfterRecordingAction)}
            >
              <SelectTrigger className="w-full max-w-[260px] bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-black)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="preview">Floating preview</SelectItem>
                <SelectItem value="editor">Open editor immediately</SelectItem>
                <SelectItem value="save">Quick save (skip editor)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-[var(--ink-muted)] mt-1">
              {afterRecordingAction === 'preview' && 'Show a mini preview with edit, folder, and delete actions'}
              {afterRecordingAction === 'editor' && 'Open the video editor immediately after recording stops'}
              {afterRecordingAction === 'save' && 'Save directly to file. Cursor is baked in, countdown is skipped.'}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-[var(--ink-black)] block">
                Ask before recording
              </label>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Choose between Quick and Studio mode each time you record
              </p>
            </div>
            <Switch
              checked={promptRecordingMode}
              onCheckedChange={(checked) => setPromptRecordingMode(checked)}
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Video (MP4)
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Frame rate
            </label>
            <OptionToggleGroup
              ariaLabel="Video frame rate"
              value={video.fps}
              options={RECORDING.VIDEO_FPS_OPTIONS}
              formatLabel={(fps) => `${fps} fps`}
              onChange={(fps) => updateVideoSettings({ fps })}
            />
          </div>

          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Quality
            </label>
            <OptionToggleGroup
              ariaLabel="Video quality"
              value={video.quality}
              options={RECORDING.VIDEO_QUALITY_OPTIONS}
              formatLabel={(quality) => `${quality}%`}
              onChange={(quality) => updateVideoSettings({ quality })}
            />
            <p className="text-xs text-[var(--ink-muted)] mt-1">
              Higher quality = larger file size
            </p>
          </div>

          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Countdown
            </label>
            <OptionToggleGroup
              ariaLabel="Video countdown"
              value={video.countdownSecs}
              options={RECORDING.COUNTDOWN_OPTIONS}
              formatLabel={formatCountdownOption}
              onChange={(countdownSecs) => updateVideoSettings({ countdownSecs })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-[var(--ink-black)] block">
                Include cursor
              </label>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Show the mouse cursor in recordings
              </p>
            </div>
            <Switch
              checked={video.includeCursor}
              onCheckedChange={(checked) => updateVideoSettings({ includeCursor: checked })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-[var(--ink-black)] block">
                Hide desktop icons
              </label>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Temporarily hide icons during recording for cleaner videos
              </p>
            </div>
            <Switch
              checked={video.hideDesktopIcons}
              onCheckedChange={(checked) => updateVideoSettings({ hideDesktopIcons: checked })}
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          GIF
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Frame rate
            </label>
            <OptionToggleGroup
              ariaLabel="GIF frame rate"
              value={gif.fps}
              options={RECORDING.GIF_FPS_OPTIONS}
              formatLabel={(fps) => `${fps} fps`}
              onChange={(fps) => updateGifSettings({ fps })}
            />
          </div>

          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Max duration
            </label>
            <OptionToggleGroup
              ariaLabel="GIF max duration"
              value={gif.maxDurationSecs}
              options={RECORDING.GIF_MAX_DURATION_OPTIONS}
              formatLabel={formatGifDurationOption}
              onChange={(maxDurationSecs) => updateGifSettings({ maxDurationSecs })}
            />
          </div>

          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Quality preset
            </label>
            <Select
              value={gif.qualityPreset}
              onValueChange={(value) => updateGifSettings({ qualityPreset: value as 'fast' | 'balanced' | 'high' })}
            >
              <SelectTrigger className="w-full max-w-[200px] bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-black)]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fast">Fast - Smaller size</SelectItem>
                <SelectItem value="balanced">Balanced</SelectItem>
                <SelectItem value="high">High - Better quality</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Countdown
            </label>
            <OptionToggleGroup
              ariaLabel="GIF countdown"
              value={gif.countdownSecs}
              options={RECORDING.COUNTDOWN_OPTIONS}
              formatLabel={formatCountdownOption}
              onChange={(countdownSecs) => updateGifSettings({ countdownSecs })}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-[var(--ink-black)] block">
                Include cursor
              </label>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Show the mouse cursor in GIF recordings
              </p>
            </div>
            <Switch
              checked={gif.includeCursor}
              onCheckedChange={(checked) => updateGifSettings({ includeCursor: checked })}
            />
          </div>
        </div>
      </section>
    </div>
  );
};
