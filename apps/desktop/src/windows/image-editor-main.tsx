import React from 'react';
import ReactDOM from 'react-dom/client';
import ImageEditorWindow from './ImageEditorWindow';
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
    console.error('Failed to initialize image editor theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ImageEditorWindow />
      <Toaster
        position="top-center"
        theme="system"
        toastOptions={{
          duration: 3000,
        }}
      />
    </React.StrictMode>
  );
}

void bootstrap();
