/**
 * ExportConfigPanel - Resolution, quality, aspect ratio settings.
 */
import { Crop } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { VideoProject, ExportConfig, AspectRatio, ExportPreset } from '../../../types';

export interface ExportConfigPanelProps {
  project: VideoProject;
  onUpdateExportConfig: (updates: Partial<ExportConfig>) => void;
  onOpenCropDialog: () => void;
}

export function ExportConfigPanel({ project, onUpdateExportConfig, onOpenCropDialog }: ExportConfigPanelProps) {
  return (
    <div className="space-y-4">
      {/* Output Resolution - Most important, put first */}
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
        {project.export.composition?.mode === 'manual' && project.export.composition?.width && (
          <p className="text-[10px] text-[var(--ink-subtle)] mt-1">
            Output: {project.export.composition.width}×{project.export.composition.height}
          </p>
        )}
      </div>

      {/* Quality Preset */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Quality</span>
        <select
          value={project.export.preset}
          onChange={(e) => onUpdateExportConfig({ preset: e.target.value as ExportPreset })}
          className="w-full h-8 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2"
        >
          <option value="draft">Draft (15fps, fast)</option>
          <option value="standard">Standard (30fps)</option>
          <option value="highQuality">High Quality (60fps)</option>
          <option value="maximum">Maximum (Source fps)</option>
          <option value="custom">Custom</option>
        </select>
      </div>

      {/* Aspect Ratio - for letterboxing */}
      <div>
        <span className="text-xs text-[var(--ink-muted)] block mb-2">Letterbox Aspect</span>
        <select
          value={project.export.aspectRatio}
          onChange={(e) => onUpdateExportConfig({ aspectRatio: e.target.value as AspectRatio })}
          className="w-full h-8 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] px-2"
        >
          <option value="auto">Auto (No letterbox)</option>
          <option value="landscape16x9">16:9 Landscape</option>
          <option value="portrait9x16">9:16 Portrait</option>
          <option value="square1x1">1:1 Square</option>
          <option value="standard4x3">4:3 Standard</option>
        </select>
      </div>

      {/* Crop Video */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-[var(--ink-muted)]">Crop Video</span>
          {project.export.crop?.enabled && (
            <span className="text-[10px] text-[var(--coral-400)] font-medium">
              {project.export.crop.width}x{project.export.crop.height}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenCropDialog}
          className="w-full justify-start gap-2"
        >
          <Crop className="w-4 h-4" />
          {project.export.crop?.enabled ? 'Edit Crop' : 'Add Crop'}
        </Button>
        {project.export.crop?.enabled && (
          <p className="text-[10px] text-[var(--ink-subtle)] mt-1.5">
            Position: {project.export.crop.x}, {project.export.crop.y}
          </p>
        )}
      </div>
    </div>
  );
}
