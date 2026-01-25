import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { initializeLogging } from './utils/logger';
import { initParityLayout } from './hooks/useParityLayout';

// Initialize logging system (enables dev mode in development builds)
initializeLogging().catch(console.error);

// Initialize parity layout from Rust (enables preview/export sync)
initParityLayout().catch(console.error);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
