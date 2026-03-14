import ReactDOM from 'react-dom/client';

import CaptureToolbarWindow from './CaptureToolbarWindow';
import '../styles.css';
import { initializeThemeFromSettings } from '@/hooks/useTheme';
import { initializeLogging } from '../utils/logger';

// Initialize logging
initializeLogging().catch(console.error);

document.documentElement.classList.add('floating-toolbar-window', 'capture-toolbar-window');
document.body.classList.add('floating-toolbar-window', 'capture-toolbar-window');

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <CaptureToolbarWindow />
);

initializeThemeFromSettings().catch((error) => {
  console.error('Failed to initialize capture toolbar theme:', error);
});
