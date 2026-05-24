/**
 * ExportDialog - Choose format, frame rate, and hardware encoding right
 * before exporting. Replaces the old Export sidebar tab.
 */
import { invoke } from '@tauri-apps/api/core';
import { Download, Film } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Switch } from '../../../components/ui/switch';
import type { ExportConfig, ExportFormat, VideoProject } from '../../../types';

export type ExportTarget = 'video' | 'gif';

export interface ExportDialogProps {
  open: boolean;
  target: ExportTarget;
  project: VideoProject;
  onOpenChange: (open: boolean) => void;
  onUpdateExportConfig: (updates: Partial<ExportConfig>) => void;
  onConfirm: () => void;
}

const FPS_DOWNSAMPLE_PRESETS = [60, 50, 30, 25, 24, 15] as const;

export function ExportDialog({
  open,
  target,
  project,
  onOpenChange,
  onUpdateExportConfig,
  onConfirm,
}: ExportDialogProps) {
  const isGif = target === 'gif';
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

  const [nvencAvailable, setNvencAvailable] = useState<boolean | null>(null);
  const [isCheckingNvenc, setIsCheckingNvenc] = useState(false);

  // Only probe NVENC while the dialog is open and MP4 is the active format —
  // GIF/WebM exports don't use the encoder, and probing while closed is wasted work.
  useEffect(() => {
    let isCancelled = false;

    if (!open || isGif || project.export.format !== 'mp4') {
      setIsCheckingNvenc(false);
      return () => {
        isCancelled = true;
      };
    }

    setNvencAvailable(null);
    setIsCheckingNvenc(true);

    invoke<boolean>('check_nvenc_available')
      .then((available) => {
        if (!isCancelled) setNvencAvailable(available);
      })
      .catch(() => {
        if (!isCancelled) setNvencAvailable(false);
      })
      .finally(() => {
        if (!isCancelled) setIsCheckingNvenc(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [open, isGif, project.export.format]);

  let hardwareEncodingCopy =
    'Use x264 for smaller files. Turn this on to prefer NVIDIA NVENC for faster MP4 exports.';
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

  const TargetIcon = isGif ? Film : Download;
  const title = isGif ? 'Export GIF' : 'Export Video';
  const description = isGif
    ? 'Pick a frame rate, then choose where to save your GIF.'
    : 'Pick a format and frame rate, then choose where to save your video.';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <TargetIcon className="h-4 w-4 text-[var(--accent-400)]" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isGif && (
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
                </SelectContent>
              </Select>
            </div>
          )}

          {!isGif && project.export.format === 'mp4' && (
            <div className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 py-2.5">
              <div className="min-w-0">
                <span className="text-xs text-[var(--ink-muted)] block">Prefer Hardware Encoding</span>
                <p className="mt-1 text-[11px] text-[var(--ink-muted)]">{hardwareEncodingCopy}</p>
              </div>
              <Switch
                aria-label="Prefer hardware encoding"
                checked={preferHardwareEncoding}
                onCheckedChange={(checked) =>
                  onUpdateExportConfig({ preferHardwareEncoding: checked })
                }
              />
            </div>
          )}

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
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="editor-choice-pill h-auto px-4 py-2 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="btn-accent h-auto px-4 py-2 rounded-md text-sm flex items-center gap-1.5"
          >
            <TargetIcon className="h-3.5 w-3.5" />
            {isGif ? 'Save GIF…' : 'Save Video…'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
