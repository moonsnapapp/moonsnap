import React from 'react';
import ReactDOM from 'react-dom/client';
import RecordingPreviewWindow from './RecordingPreviewWindow';
import '../styles.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <RecordingPreviewWindow />
  </React.StrictMode>
);
