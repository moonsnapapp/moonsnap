/**
 * ExportConfigPanel - Format, FPS, resolution, crop, and audio settings.
 */
import { useMemo } from 'react';
import { Crop, X, Lock } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { AudioControlsPanel } from './AudioControlsPanel';
import type { VideoProject, ExportConfig, ExportFormat, AudioTrackSettings } from '../../../types';
import { calculateCompositionOutputSize } from '@/utils/compositionBounds';
import { hasVideoBackgroundFrameStyling } from '@/utils/backgroundFrameStyling';
import { getContentDimensionsFromCrop } from '@/utils/videoContentDimensions';
import { useLicenseStore } from '@/stores/licenseStore';

export interface ExportConfigPanelProps {
  project: VideoProject;
  onUpdateExportConfig: (updates: Partial<ExportConfig>) => void;
  onUpdateAudioConfig: (updates: Partial<AudioTrackSettings>) => void;
  onOpenCropDialog: () => void;
}

export function ExportConfigPanel({ project, onUpdateExportConfig, onUpdateAudioConfig, onOpenCropDialog }: ExportConfigPanelProps) {
  const isPro = useLicenseStore((s) => s.isPro());

  const outputResolution = useMemo(() => {
    const crop = project.export.crop;
    const bg = project.export.background;
    const { width: contentW, height: contentH } = getContentDimensionsFromCrop(
      crop,
      project.sources.originalWidth,
      project.sources.originalHeight
    );
    const hasStyling = hasVideoBackgroundFrameStyling(bg);
    const padding = hasStyling ? (bg?.padding ?? 0) : 0;

    return calculateCompositionOutputSize(
      contentW,
      contentH,
      padding,
      project.export.composition
    );
  }, [
    project.export.crop,
    project.export.background,
    project.export.composition,
    project.sources.originalWidth,
    project.sources.originalHeight,
  ]);

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
          <option value="gif" disabled={!isPro}>
            {isPro ? 'GIF' : 'GIF (Pro)'}
          </option>
        </select>
        {!isPro && project.export.format === 'gif' && (
          <div className="flex items-center gap-1.5 mt-1.5 text-xs text-[var(--coral-500)]">
            <Lock size={12} />
            <span>GIF export requires MoonSnap Pro</span>
          </div>
        )}
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
          <option value="3840x2160">4K (3840x2160)</option>
          <option value="1920x1080">1080p (1920x1080)</option>
          <option value="1280x720">720p (1280x720)</option>
          <option value="1080x1920">1080p Portrait (1080x1920)</option>
          <option value="1080x1080">Square (1080x1080)</option>
        </select>
        <div className="flex items-center gap-2 mt-2 px-2.5 py-1.5 rounded-md bg-[var(--polar-mist)] border border-[var(--glass-border)]">
          <span className="text-[11px] text-[var(--ink-muted)]">Output</span>
          <span className="text-[11px] text-[var(--ink-dark)] font-mono font-medium">
            {`${outputResolution.width}x${outputResolution.height}`}
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

