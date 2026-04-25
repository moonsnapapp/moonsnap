/**
 * VideoEditorPreview - Video preview container.
 * Wraps the GPUVideoPreview component with appropriate layout and error handling.
 */
import { GPUVideoPreview } from '../../components/VideoEditor/GPUVideoPreview';
import { GPUErrorBoundary } from '../../components/VideoEditor/GPUErrorBoundary';
import {
  CanvasCaptureNavigation,
  type CaptureNavigationControls,
} from '../../components/Editor/CanvasCaptureNavigation';

interface VideoEditorPreviewProps {
  isActive?: boolean;
  captureNavigation?: CaptureNavigationControls;
}

export function VideoEditorPreview({ isActive = true, captureNavigation }: VideoEditorPreviewProps) {

  return (
    <div className="editor-preview-shell flex-1 min-h-0 p-4">
      <GPUErrorBoundary>
        <GPUVideoPreview isActive={isActive} />
      </GPUErrorBoundary>
      {captureNavigation && (
        <CanvasCaptureNavigation {...captureNavigation} />
      )}
    </div>
  );
}
