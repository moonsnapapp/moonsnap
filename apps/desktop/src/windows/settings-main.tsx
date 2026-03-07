import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsWindow from './SettingsWindow';
import '../styles.css';
import { initializeLogging } from '../utils/logger';
import { initializeThemeFromSettings } from '@/hooks/useTheme';

// Initialize logging
initializeLogging().catch(console.error);

async function bootstrap() {
  try {
    await initializeThemeFromSettings();
  } catch (error) {
    console.error('Failed to initialize settings window theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <SettingsWindow />
    </React.StrictMode>
  );
}

void bootstrap();
