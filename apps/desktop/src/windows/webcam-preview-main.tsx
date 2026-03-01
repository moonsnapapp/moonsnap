import React from 'react';
import ReactDOM from 'react-dom/client';
import WebcamPreviewWindow from './WebcamPreviewWindow';
import './webcam-preview.css';

// Note: Do NOT import styles.css here - it contains Tailwind which conflicts with inline styles

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <WebcamPreviewWindow />
  </React.StrictMode>
);
