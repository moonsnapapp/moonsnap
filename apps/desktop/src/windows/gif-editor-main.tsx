import React from 'react';
import ReactDOM from 'react-dom/client';
import GifEditorWindow from './GifEditorWindow';
import '../styles.css';
import { initializeLogging } from '../utils/logger';
import { Toaster } from 'sonner';
import { initializeThemeFromSettings } from '@/hooks/useTheme';

initializeLogging().catch(console.error);

async function bootstrap() {
  try {
    await initializeThemeFromSettings();
  } catch (error) {
    console.error('Failed to initialize gif editor theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <GifEditorWindow />
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
