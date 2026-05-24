/**
 * VideoEditorPreview - Video preview container.
 * Wraps the GPUVideoPreview component with appropriate layout and error handling.
 */
import { Info } from 'lucide-react';
import { GPUVideoPreview } from '../../components/VideoEditor/GPUVideoPreview';
import { GPUErrorBoundary } from '../../components/VideoEditor/GPUErrorBoundary';
import {
  CanvasCaptureNavigation,
  type CaptureNavigationControls,
} from '../../components/Editor/CanvasCaptureNavigation';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { selectProject } from '../../stores/videoEditor/selectors';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { ProjectInfoPanel } from './panels/ProjectInfoPanel';

interface VideoEditorPreviewProps {
  isActive?: boolean;
  captureNavigation?: CaptureNavigationControls;
}

export function VideoEditorPreview({ isActive = true, captureNavigation }: VideoEditorPreviewProps) {
  const project = useVideoEditorStore(selectProject);

  return (
    <div className="editor-preview-shell flex-1 min-h-0 p-4">
      <GPUErrorBoundary>
        <GPUVideoPreview isActive={isActive} />
      </GPUErrorBoundary>
      {captureNavigation && (
        <CanvasCaptureNavigation {...captureNavigation} />
      )}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Project info"
            className="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full text-[var(--ink-muted)] hover:text-[var(--ink-black)] hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          >
            <Info className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={6} className="w-64">
          <ProjectInfoPanel project={project} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
