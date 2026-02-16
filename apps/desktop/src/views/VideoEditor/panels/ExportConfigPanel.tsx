/**
 * ExportConfigPanel - Format, FPS, resolution, crop, and audio settings.
 */
import { useMemo } from 'react';
import { Crop, X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { AudioControlsPanel } from './AudioControlsPanel';
import type { VideoProject, ExportConfig, ExportFormat, AudioTrackSettings } from '../../../types';

function toEven(value: number): number {
  return Math.floor(value / 2) * 2;
}

export interface ExportConfigPanelProps {
  project: VideoProject;
  onUpdateExportConfig: (updates: Partial<ExportConfig>) => void;
  onUpdateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
  onOpenCropDialog: () => void;
}

export function ExportConfigPanel({ project, onUpdateExportConfig, onUpdateAudioConfig, onOpenCropDialog }: ExportConfigPanelProps) {
  const autoResolution = useMemo(() => {
    const crop = project.export.crop;
    const bg = project.export.background;
    const contentW = crop?.enabled && crop.width > 0 ? crop.width : project.sources.originalWidth;
    const contentH = crop?.enabled && crop.height > 0 ? crop.height : project.sources.originalHeight;
    const hasStyling = bg?.enabled && (bg.padding > 0 || bg.rounding > 0 || bg.shadow?.enabled || bg.border?.enabled);
    const padding = hasStyling ? (bg?.padding ?? 0) : 0;
    return {
      width: toEven(contentW + padding * 2),
      height: toEven(contentH + padding * 2),
    };
  }, [project.export.crop, project.export.background, project.sources.originalWidth, project.sources.originalHeight]);
  return (
    <div className="space-y-4">
      {/* Format */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Format</span>
        <select
          value={project.export.format}
          onChange={(e) => onUpdateExportConfig({ format: e.target.value as ExportFormat })}
          className="w-full h-8 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2"
        >
          <option value="mp4">MP4</option>
          <option value="webm">WebM</option>
          <option value="gif">GIF</option>
        </select>
      </div>

      {/* FPS */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Frame Rate</span>
        <select
          value={project.export.fps}
          onChange={(e) => onUpdateExportConfig({ fps: Number(e.target.value) })}
          className="w-full h-8 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2"
        >
          <option value={15}>15 fps</option>
          <option value={24}>24 fps</option>
          <option value={30}>30 fps</option>
          <option value={60}>60 fps</option>
        </select>
      </div>

      {/* Output Resolution */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Output Resolution</span>
        <select
          value={
            project.export.composition?.mode === 'manual' && project.export.composition?.width && project.export.composition?.height
              ? `${project.export.composition.width}x${project.export.composition.height}`
              : 'auto'
          }
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'auto') {
              onUpdateExportConfig({
                composition: { mode: 'auto', aspectRatio: null, aspectPreset: null, width: null, height: null }
              });
            } else {
              const [w, h] = value.split('x').map(Number);
              onUpdateExportConfig({
                composition: { mode: 'manual', aspectRatio: w / h, aspectPreset: value, width: w, height: h }
              });
            }
          }}
          className="w-full h-8 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2"
        >
          <option value="auto">Auto (Match Source)</option>
          <option value="3840x2160">4K (3840×2160)</option>
          <option value="1920x1080">1080p (1920×1080)</option>
          <option value="1280x720">720p (1280×720)</option>
          <option value="1080x1920">1080p Portrait (1080×1920)</option>
          <option value="1080x1080">Square (1080×1080)</option>
        </select>
        <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-md bg-[var(--polar-mist)] border border-[var(--glass-border)]">
          <span className="text-[11px] text-[var(--ink-muted)]">Output</span>
          <span className="text-[11px] text-[var(--ink-dark)] font-mono font-medium">
            {project.export.composition?.mode === 'manual' && project.export.composition?.width
              ? `${project.export.composition.width}×${project.export.composition.height}`
              : `${autoResolution.width}×${autoResolution.height}`}
          </span>
        </div>
      </div>

      {/* Crop Video */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Crop Video</span>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenCropDialog}
            className="flex-1 justify-start gap-2"
          >
            <Crop className="w-4 h-4" />
            {project.export.crop?.enabled ? 'Edit Crop' : 'Add Crop'}
          </Button>
          {project.export.crop?.enabled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onUpdateExportConfig({
                crop: { enabled: false, x: 0, y: 0, width: 0, height: 0, lockAspectRatio: false, aspectRatio: null }
              })}
              className="px-2 text-[var(--ink-muted)] hover:text-[var(--error)]"
              title="Reset Crop"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Audio Controls */}
      <AudioControlsPanel
        project={project}
        onUpdateAudioConfig={onUpdateAudioConfig}
      />

    </div>
  );
}
