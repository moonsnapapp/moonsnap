import React from 'react';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RECORDING, formatCountdownOption, formatGifDurationOption } from '@/constants';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';

interface OptionPillGroupProps {
  value: number;
  options: readonly number[];
  formatLabel: (value: number) => string;
  onChange: (value: number) => void;
}

const OptionPillGroup: React.FC<OptionPillGroupProps> = ({
  value,
  options,
  formatLabel,
  onChange,
}) => {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          onClick={() => onChange(option)}
          className={`editor-choice-pill px-3 py-2 text-xs ${
            value === option ? 'editor-choice-pill--active' : ''
          }`}
        >
          {formatLabel(option)}
        </button>
      ))}
    </div>
  );
};

export const RecordingsTab: React.FC = () => {
  const {
    settings,
    updateVideoSettings,
    updateGifSettings,
    promptRecordingMode,
    setPromptRecordingMode,
    snapToolbarToSelection,
    setSnapToolbarToSelection,
    showToolbarInRecording,
    setShowToolbarInRecording,
  } = useCaptureSettingsStore();
  const { video, gif } = settings;

  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Behavior
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
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
              aria-label="Ask before recording"
              checked={promptRecordingMode}
              onCheckedChange={(checked) => setPromptRecordingMode(checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-[var(--ink-black)] block">
                Snap toolbar to selection
              </label>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Position the capture toolbar next to your selected area
              </p>
            </div>
            <Switch
              aria-label="Snap toolbar to selection"
              checked={snapToolbarToSelection}
              onCheckedChange={(checked) => setSnapToolbarToSelection(checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm text-[var(--ink-black)] block">
                Show toolbar in recording
              </label>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Include the capture toolbar in your screen recordings
              </p>
            </div>
            <Switch
              aria-label="Show toolbar in recording"
              checked={showToolbarInRecording}
              onCheckedChange={(checked) => setShowToolbarInRecording(checked)}
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
            <OptionPillGroup
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
            <OptionPillGroup
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
            <OptionPillGroup
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
            <OptionPillGroup
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
            <OptionPillGroup
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
            <OptionPillGroup
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
