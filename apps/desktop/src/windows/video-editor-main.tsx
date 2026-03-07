import React from 'react';
import ReactDOM from 'react-dom/client';
import VideoEditorWindow from './VideoEditorWindow';
import { VideoEditorProvider } from '@/contexts/VideoEditorContext';
import '../styles.css';
import { initializeLogging } from '../utils/logger';
import { Toaster } from 'sonner';
import { initializeThemeFromSettings } from '@/hooks/useTheme';

// Initialize logging
initializeLogging().catch(console.error);

async function bootstrap() {
  try {
    await initializeThemeFromSettings();
  } catch (error) {
    console.error('Failed to initialize video editor theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <VideoEditorProvider>
        <VideoEditorWindow />
        <Toaster
          position="bottom-right"
          toastOptions={{
            className: 'glass-toast',
            duration: 3000,
          }}
        />
      </VideoEditorProvider>
    </React.StrictMode>
  );
}

void bootstrap();
