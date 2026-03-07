import React from 'react';
import ReactDOM from 'react-dom/client';
import ScreenshotPreviewWindow from './ScreenshotPreviewWindow';
import '../styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ScreenshotPreviewWindow />
  </React.StrictMode>
);
