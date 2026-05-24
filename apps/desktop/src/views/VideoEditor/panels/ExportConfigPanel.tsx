/**
 * ExportConfigPanel - Format, FPS, encoding, motion blur, and audio settings.
 *
 * Output Canvas size and Crop controls live in the preview top bar so they
 * are always reachable without opening this tab.
 */
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import { AudioControlsPanel } from './AudioControlsPanel';
import type { VideoProject, ExportConfig, ExportFormat, AudioTrackSettings } from '../../../types';

export interface ExportConfigPanelProps {
  project: VideoProject;
  onUpdateExportConfig: (updates: Partial<ExportConfig>) => void;
  onUpdateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
}

// Common downsample targets offered alongside "Match Source" — filtered to
// values strictly below the source fps to keep the UI honest. The renderer
// caps any requested fps to the source rate.
const FPS_DOWNSAMPLE_PRESETS = [60, 50, 30, 25, 24, 15] as const;

export function ExportConfigPanel({ project, onUpdateExportConfig, onUpdateAudioConfig }: ExportConfigPanelProps) {
  const [nvencAvailable, setNvencAvailable] = useState<boolean | null>(null);
  const [isCheckingNvenc, setIsCheckingNvenc] = useState(false);
  const sourceFps = project.sources.fps;
  const preferHardwareEncoding = project.export.preferHardwareEncoding ?? false;

  const fpsOptions = [
    { value: sourceFps, label: `Match Source (${sourceFps} fps)` },
    ...FPS_DOWNSAMPLE_PRESETS.filter((preset) => preset < sourceFps).map((preset) => ({
      value: preset,
      label: `${preset} fps`,
    })),
  ];
  const exportFpsValue = Math.min(
    Math.max(1, project.export.fps || sourceFps),
    sourceFps
  );

  useEffect(() => {
    let isCancelled = false;

    if (project.export.format !== 'mp4') {
      setIsCheckingNvenc(false);
      return () => {
        isCancelled = true;
      };
    }

    setNvencAvailable(null);
    setIsCheckingNvenc(true);

    invoke<boolean>('check_nvenc_available')
      .then((available) => {
        if (!isCancelled) {
          setNvencAvailable(available);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setNvencAvailable(false);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsCheckingNvenc(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [project.export.format]);

  let hardwareEncodingCopy = 'Use x264 for smaller files. Turn this on to prefer NVIDIA NVENC for faster MP4 exports.';
  if (isCheckingNvenc) {
    hardwareEncodingCopy = 'Checking for NVIDIA NVENC support on this system...';
  } else if (nvencAvailable) {
    hardwareEncodingCopy = preferHardwareEncoding
      ? 'NVIDIA NVENC is available. MP4 exports will favor speed over file-size efficiency.'
      : 'NVIDIA NVENC is available if you want faster MP4 exports with decent quality.';
  } else if (preferHardwareEncoding) {
    hardwareEncodingCopy = 'NVENC was not detected, so MP4 exports will fall back to x264 automatically.';
  } else if (nvencAvailable === false) {
    hardwareEncodingCopy = 'No NVIDIA NVENC encoder was detected. MP4 exports will use x264.';
  }

  return (
    <div className="min-w-0 space-y-4">
      {/* Format */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Format</span>
        <Select
          value={project.export.format}
          onValueChange={(value) =>
            onUpdateExportConfig({ format: value as ExportFormat })
          }
        >
          <SelectTrigger className="h-8 min-w-0 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
            <SelectItem value="mp4">MP4</SelectItem>
            <SelectItem value="webm">WebM</SelectItem>
            <SelectItem value="gif">GIF</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {project.export.format === 'mp4' && (
        <div>
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 py-2.5">
            <div className="min-w-0">
              <span className="text-xs text-[var(--ink-muted)] block">Prefer Hardware Encoding</span>
              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                {hardwareEncodingCopy}
              </p>
            </div>
            <Switch
              aria-label="Prefer hardware encoding"
              checked={preferHardwareEncoding}
              onCheckedChange={(checked) => onUpdateExportConfig({ preferHardwareEncoding: checked })}
            />
          </div>
        </div>
      )}

      {/* FPS */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Frame Rate</span>
        <Select
          value={String(exportFpsValue)}
          onValueChange={(value) => onUpdateExportConfig({ fps: Number(value) })}
        >
          <SelectTrigger className="h-8 min-w-0 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
            {fpsOptions.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Audio Controls */}
      <AudioControlsPanel
        project={project}
        onUpdateAudioConfig={onUpdateAudioConfig}
      />

    </div>
  );
}
