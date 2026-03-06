import React from 'react';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';

export const RecordingsTab: React.FC = () => {
  const {
    settings,
    updateVideoSettings,
    updateGifSettings,
    afterRecordingAction,
    setAfterRecordingAction,
  } = useCaptureSettingsStore();
  const { video, gif } = settings;

  return (
    <div className="space-y-6">
      {/* Behavior Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Behavior
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          {/* After recording action */}
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
        </div>
      </section>

      {/* Video Settings */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Video (MP4)
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          {/* FPS */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--ink-black)]">
                Frame rate
              </label>
              <span className="text-sm text-[var(--ink-muted)]">
                {video.fps} FPS
              </span>
            </div>
            <Slider
              value={[video.fps]}
              onValueChange={(value) => updateVideoSettings({ fps: value[0] })}
              min={10}
              max={60}
              step={5}
            />
          </div>

          {/* Quality */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--ink-black)]">
                Quality
              </label>
              <span className="text-sm text-[var(--ink-muted)]">
                {video.quality}%
              </span>
            </div>
            <Slider
              value={[video.quality]}
              onValueChange={(value) => updateVideoSettings({ quality: value[0] })}
              min={10}
              max={100}
              step={5}
            />
            <p className="text-xs text-[var(--ink-muted)] mt-1">
              Higher quality = larger file size
            </p>
          </div>

          {/* Countdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--ink-black)]">
                Countdown
              </label>
              <span className="text-sm text-[var(--ink-muted)]">
                {video.countdownSecs === 0 ? 'Off' : `${video.countdownSecs}s`}
              </span>
            </div>
            <Slider
              value={[video.countdownSecs]}
              onValueChange={(value) => updateVideoSettings({ countdownSecs: value[0] })}
              min={0}
              max={10}
              step={1}
            />
          </div>

          {/* Include Cursor */}
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

          {/* Hide Desktop Icons */}
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

      {/* GIF Settings */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          GIF
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          {/* GIF FPS */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--ink-black)]">
                Frame rate
              </label>
              <span className="text-sm text-[var(--ink-muted)]">
                {gif.fps} FPS
              </span>
            </div>
            <Slider
              value={[gif.fps]}
              onValueChange={(value) => updateGifSettings({ fps: value[0] })}
              min={5}
              max={30}
              step={5}
            />
          </div>

          {/* GIF Max Duration */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--ink-black)]">
                Max duration
              </label>
              <span className="text-sm text-[var(--ink-muted)]">
                {gif.maxDurationSecs}s
              </span>
            </div>
            <Slider
              value={[gif.maxDurationSecs]}
              onValueChange={(value) => updateGifSettings({ maxDurationSecs: value[0] })}
              min={5}
              max={60}
              step={5}
            />
          </div>

          {/* GIF Quality Preset */}
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

          {/* GIF Countdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-[var(--ink-black)]">
                Countdown
              </label>
              <span className="text-sm text-[var(--ink-muted)]">
                {gif.countdownSecs === 0 ? 'Off' : `${gif.countdownSecs}s`}
              </span>
            </div>
            <Slider
              value={[gif.countdownSecs]}
              onValueChange={(value) => updateGifSettings({ countdownSecs: value[0] })}
              min={0}
              max={10}
              step={1}
            />
          </div>

          {/* GIF Include Cursor */}
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
