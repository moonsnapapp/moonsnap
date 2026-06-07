/**
 * VideoEditorToolbar - Top bar with back button and project name.
 */
import { ArrowLeft } from 'lucide-react';
import type { VideoProject } from '../../types';
import { getVideoEditorStatusLabel, isQuickCaptureProject } from '../../utils/videoExportMode';

export interface VideoEditorToolbarProps {
  project: VideoProject | null;
  onBack: () => void;
}

function VideoEditorProjectTitle({ project }: { project: VideoProject | null }) {
  return (
    <span className="text-sm font-medium text-[var(--ink-dark)] truncate">
      {project?.name || 'Video Editor'}
    </span>
  );
}

function QuickCaptureBadge({ isQuickCapture }: { isQuickCapture: boolean }) {
  if (!isQuickCapture) return null;

  return (
    <span className="editor-meta-pill px-2 py-0.5 bg-[var(--accent-400)]/12 text-[10px] font-medium text-[var(--accent-500)] whitespace-nowrap">
      Quick Capture
    </span>
  );
}

function ProjectStatusMeta({ project }: { project: VideoProject | null }) {
  if (!project) return null;

  const isQuickCapture = isQuickCaptureProject(project);
  const statusLabel = getVideoEditorStatusLabel(project);

  return (
    <>
      <QuickCaptureBadge isQuickCapture={isQuickCapture} />
      <span className="editor-meta-pill px-2 py-0.5 bg-[var(--polar-frost)] text-[10px] font-medium text-[var(--ink-subtle)] whitespace-nowrap">
        {statusLabel}
      </span>
    </>
  );
}

export function VideoEditorToolbar({ project, onBack }: VideoEditorToolbarProps) {
  return (
    <div className="video-editor-toolbar h-11 flex items-center px-3">
      <button
        onClick={onBack}
        className="glass-btn h-7 w-7 flex items-center justify-center"
        title="Back to Library"
      >
        <ArrowLeft className="w-4 h-4" />
      </button>
      <div className="ml-3 min-w-0 flex items-center gap-2">
        <VideoEditorProjectTitle project={project} />
        <ProjectStatusMeta project={project} />
      </div>
    </div>
  );
}
