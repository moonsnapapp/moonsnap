import React from 'react';
import ReactDOM from 'react-dom/client';
import CaptureToolbarWindow from './CaptureToolbarWindow';
import '../styles.css';
import { initializeThemeFromSettings } from '@/hooks/useTheme';
import { initializeLogging } from '../utils/logger';

// Initialize logging
initializeLogging().catch(console.error);

async function bootstrap() {
  try {
    await initializeThemeFromSettings();
  } catch (error) {
    console.error('Failed to initialize capture toolbar theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <CaptureToolbarWindow />
    </React.StrictMode>
  );
}

void bootstrap();
