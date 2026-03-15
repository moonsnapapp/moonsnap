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

export function VideoEditorToolbar({ project, onBack }: VideoEditorToolbarProps) {
  const isQuickCapture = isQuickCaptureProject(project);
  const statusLabel = getVideoEditorStatusLabel(project);

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
        <span className="text-sm font-medium text-[var(--ink-dark)] truncate">
          {project?.name || 'Video Editor'}
        </span>
        {project && (
          <>
            {isQuickCapture && (
              <span className="editor-meta-pill px-2 py-0.5 bg-[var(--coral-400)]/12 text-[10px] font-medium text-[var(--coral-500)] whitespace-nowrap">
                Quick Capture
              </span>
            )}
            <span className="editor-meta-pill px-2 py-0.5 bg-[var(--polar-frost)] text-[10px] font-medium text-[var(--ink-subtle)] whitespace-nowrap">
              {statusLabel}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
