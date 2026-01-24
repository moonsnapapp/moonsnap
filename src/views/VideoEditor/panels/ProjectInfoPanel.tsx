/**
 * ProjectInfoPanel - Read-only project metadata display.
 */
import type { VideoProject } from '../../../types';

export interface ProjectInfoPanelProps {
  project: VideoProject | null;
}

export function ProjectInfoPanel({ project }: ProjectInfoPanelProps) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">Project</label>
        <p className="text-sm text-[var(--ink-dark)] mt-1 truncate">
          {project?.name ?? 'No project loaded'}
        </p>
      </div>

      {project && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-[var(--ink-subtle)] uppercase">Resolution</label>
            <p className="text-xs text-[var(--ink-dark)] font-mono mt-0.5">
              {project.sources.originalWidth}x{project.sources.originalHeight}
            </p>
          </div>
          <div>
            <label className="text-[10px] text-[var(--ink-subtle)] uppercase">Frame Rate</label>
            <p className="text-xs text-[var(--ink-dark)] font-mono mt-0.5">
              {project.sources.fps} fps
            </p>
          </div>
          <div>
            <label className="text-[10px] text-[var(--ink-subtle)] uppercase">Duration</label>
            <p className="text-xs text-[var(--ink-dark)] font-mono mt-0.5">
              {Math.floor(project.timeline.durationMs / 60000)}:{String(Math.floor((project.timeline.durationMs % 60000) / 1000)).padStart(2, '0')}
            </p>
          </div>
          <div>
            <label className="text-[10px] text-[var(--ink-subtle)] uppercase">Zoom Regions</label>
            <p className="text-xs text-[var(--ink-dark)] mt-0.5">
              {project.zoom.regions.length}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
