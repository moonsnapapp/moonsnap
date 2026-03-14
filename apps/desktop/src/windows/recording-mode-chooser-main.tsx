import ReactDOM from 'react-dom/client';

import '../styles.css';
import { initializeThemeFromSettings } from '@/hooks/useTheme';
import { initializeLogging } from '@/utils/logger';
import RecordingModeChooserWindow from './RecordingModeChooserWindow';

initializeLogging().catch(console.error);

document.documentElement.classList.add('floating-toolbar-window', 'recording-mode-chooser-window');
document.body.classList.add('floating-toolbar-window', 'recording-mode-chooser-window');

async function bootstrap() {
  try {
    await initializeThemeFromSettings();
  } catch (error) {
    console.error('Failed to initialize recording mode chooser theme:', error);
  }

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <RecordingModeChooserWindow />
  );
}

void bootstrap();
