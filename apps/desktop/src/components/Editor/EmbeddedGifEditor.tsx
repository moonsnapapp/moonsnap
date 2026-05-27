import React from 'react';
import { useCaptureStore } from '@/stores/captureStore';
import { GifEditor } from '@/windows/GifEditorWindow';

interface EmbeddedGifEditorProps {
  onClose: () => void;
}

export const EmbeddedGifEditor: React.FC<EmbeddedGifEditorProps> = ({ onClose }) => {
  const gifPath = useCaptureStore((s) => s.currentGifPath);

  if (!gifPath) {
    return (
      <div className="editor-window flex-1 flex items-center justify-center">
        <p className="text-sm text-(--ink-muted)">No GIF selected</p>
      </div>
    );
  }

  // Key by path so switching between GIFs in the sidebar fully resets the
  // editor state (frame list, playback position, transforms).
  return (
    <GifEditor key={gifPath} path={gifPath} embedded onClose={onClose} />
  );
};
