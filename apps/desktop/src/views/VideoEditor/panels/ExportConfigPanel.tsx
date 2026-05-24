/**
 * ExportConfigPanel - Format, FPS, encoding, motion blur, and audio settings.
 *
 * Output Canvas size and Crop controls live in the preview top bar so they
 * are always reachable without opening this tab.
 */
import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { Slider } from '../../../components/ui/slider';
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

export function ExportConfigPanel({ project, onUpdateExportConfig, onUpdateAudioConfig }: ExportConfigPanelProps) {
  const [nvencAvailable, setNvencAvailable] = useState<boolean | null>(null);
  const [isCheckingNvenc, setIsCheckingNvenc] = useState(false);
  const sourceFps = project.sources.fps;
  const preferHardwareEncoding = project.export.preferHardwareEncoding ?? false;
  const zoomMotionBlur = Math.max(0, Math.min(2, project.export.zoomMotionBlur ?? 0));

  useEffect(() => {
    if (project.export.fps !== sourceFps) {
      onUpdateExportConfig({ fps: sourceFps });
    }
  }, [onUpdateExportConfig, project.export.fps, sourceFps]);

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
          value={String(sourceFps)}
          disabled
        >
          <SelectTrigger className="h-8 min-w-0 w-full border-[var(--glass-border)] bg-[var(--polar-mist)] px-2 text-sm text-[var(--ink-dark)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
            <SelectItem value={String(sourceFps)}>
              Match Source ({sourceFps} fps)
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
          Frame-rate conversion is not supported yet, so exports match the source.
        </p>
      </div>

      {/* Zoom Motion Blur */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs text-[var(--ink-muted)]">Zoom Motion Blur</span>
          <span className="text-xs text-[var(--ink-dark)] font-mono">{Math.round(zoomMotionBlur * 100)}%</span>
        </div>
        <Slider
          value={[zoomMotionBlur * 100]}
          min={0}
          max={200}
          step={5}
          onValueChange={(values) => onUpdateExportConfig({ zoomMotionBlur: values[0] / 100 })}
        />
        <p className="mt-1.5 text-[11px] text-[var(--ink-muted)]">
          Softens fast zoom-ins, zoom-outs, and focus moves in export.
        </p>
      </div>

      {/* Audio Controls */}
      <AudioControlsPanel
        project={project}
        onUpdateAudioConfig={onUpdateAudioConfig}
      />

    </div>
  );
}
