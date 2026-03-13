import React from 'react';
import ReactDOM from 'react-dom/client';

import '../styles.css';
import { initializeThemeFromSettings } from '@/hooks/useTheme';
import { initializeLogging } from '@/utils/logger';
import RecordingControlsWindow from './RecordingControlsWindow';

initializeLogging().catch(console.error);

document.documentElement.classList.add('recording-controls-window');
document.body.classList.add('recording-controls-window');

async function bootstrap() {
  try {
    await initializeThemeFromSettings();
  } catch (error) {
    console.error('Failed to initialize recording controls theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <RecordingControlsWindow />
    </React.StrictMode>
  );
}

void bootstrap();
