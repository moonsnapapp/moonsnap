/**
 * Unified logging system for MoonSnap frontend.
 * 
 * In dev mode:
 * - Intercepts all console.* calls and sends to backend
 * - Logs all Tauri events automatically
 * - Press Ctrl+Shift+L to open log directory
 * 
 * In production:
 * - Only explicit logger calls are persisted
 * - Errors are always logged
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Track if dev mode logging is enabled
let devModeEnabled = false;
let eventUnlisteners: UnlistenFn[] = [];

// Store original console methods
const originalConsole = {
  log: console.log.bind(console),
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

interface LogEntry {
  level: LogLevel;
  source: string;
  message: string;
  timestamp: number;
}

const MAX_LOG_STRING_LENGTH = 400;
const MAX_SANITIZE_DEPTH = 5;
const BASE64_MIN_LENGTH = 120;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

// Buffer for batching logs
let logBuffer: LogEntry[] = [];
let flushTimeout: ReturnType<typeof setTimeout> | null = null;
const FLUSH_INTERVAL = 1000; // Flush every 1 second
const MAX_BUFFER_SIZE = 50; // Or when buffer reaches this size

/**
 * Flush buffered logs to backend
 */
async function flushLogs(): Promise<void> {
  if (logBuffer.length === 0) return;

  const logsToSend = logBuffer;
  logBuffer = [];

  try {
    await invoke('write_logs', {
      logs: logsToSend.map(log => [log.level, log.source, log.message])
    });
  } catch (error) {
    // If backend fails, just log to console
    console.error('[Logger] Failed to write logs to backend:', error);
  }
}

/**
 * Schedule a flush if not already scheduled
 */
function scheduleFlush(): void {
  if (flushTimeout) return;
  
  flushTimeout = setTimeout(() => {
    flushTimeout = null;
    flushLogs();
  }, FLUSH_INTERVAL);
}

/**
 * Add a log entry to the buffer
 */
function addLog(level: LogLevel, source: string, message: string): void {
  // Drop debug logs entirely to keep log files concise.
  if (level === 'debug') return;

  const entry: LogEntry = {
    level,
    source,
    message,
    timestamp: Date.now(),
  };

  logBuffer.push(entry);

  // Flush immediately if buffer is full or if it's an error
  if (logBuffer.length >= MAX_BUFFER_SIZE || level === 'error') {
    flushLogs();
  } else {
    scheduleFlush();
  }
}

/**
 * Format arguments into a string message
 */
function formatMessage(...args: unknown[]): string {
  function sanitizeString(value: string): string {
    if (value.startsWith('data:image/')) {
      const headerEnd = value.indexOf(',');
      const header = headerEnd > 0 ? value.slice(0, headerEnd) : 'data:image';
      return `[redacted-data-url ${header};len=${value.length}]`;
    }

    const compact = value.replace(/\s+/g, '');
    if (
      compact.length >= BASE64_MIN_LENGTH &&
      compact.length % 4 === 0 &&
      BASE64_RE.test(compact)
    ) {
      return `[redacted-base64 len=${value.length}]`;
    }

    if (value.length > MAX_LOG_STRING_LENGTH) {
      return `${value.slice(0, MAX_LOG_STRING_LENGTH)}...[truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`;
    }

    return value;
  }

  function sanitizeValue(value: unknown, depth = 0): unknown {
    if (depth > MAX_SANITIZE_DEPTH) return '[max-depth]';
    if (typeof value === 'string') return sanitizeString(value);
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
    if (value instanceof Error) return `${value.name}: ${value.message}`;

    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, depth + 1));
    }

    if (typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        result[key] = sanitizeValue(val, depth + 1);
      }
      return result;
    }

    return String(value);
  }

  return args.map(arg => {
    if (typeof arg === 'string') return sanitizeString(arg);
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    try {
      return JSON.stringify(sanitizeValue(arg));
    } catch {
      return String(sanitizeValue(arg));
    }
  }).join(' ');
}

/**
 * Create a logger instance for a specific source/module
 *
 * Debug/info logs go to log files only (no console spam).
 * Warn/error logs go to both console and log files.
 */
export function createLogger(source: string) {
  return {
    debug(..._args: unknown[]): void {
      // Debug logging disabled by design.
    },

    info(...args: unknown[]): void {
      const message = formatMessage(...args);
      // Info logs go to file only, not console
      addLog('info', source, message);
    },

    warn(...args: unknown[]): void {
      const message = formatMessage(...args);
      // Warnings show in console and log file
      originalConsole.warn(`[${source}]`, ...args);
      addLog('warn', source, message);
    },

    error(...args: unknown[]): void {
      const message = formatMessage(...args);
      // Errors show in console and log file
      originalConsole.error(`[${source}]`, ...args);
      addLog('error', source, message);
    },

    /**
     * Log with explicit level
     */
    log(level: LogLevel, ...args: unknown[]): void {
      if (level === 'debug') return;

      const message = formatMessage(...args);
      // Only warn/error go to console
      if (level === 'warn' || level === 'error') {
        originalConsole[level](`[${source}]`, ...args);
      }
      addLog(level, source, message);
    },
  };
}

// Default logger for general use
export const logger = createLogger('App');

// Pre-created loggers for common modules
export const recordingLogger = createLogger('Recording');
export const captureLogger = createLogger('Capture');
export const libraryLogger = createLogger('Library');
export const editorLogger = createLogger('Editor');
export const webcamLogger = createLogger('Webcam');
export const toolbarLogger = createLogger('Toolbar');
export const videoEditorLogger = createLogger('VideoEditor');
export const settingsLogger = createLogger('Settings');
export const hotkeyLogger = createLogger('Hotkey');
export const audioLogger = createLogger('Audio');
export const licenseLogger = createLogger('License');

/**
 * Flush all pending logs immediately (call on app shutdown)
 */
export async function flushAllLogs(): Promise<void> {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
    flushTimeout = null;
  }
  await flushLogs();
}

/**
 * Get the log directory path
 */
export async function getLogDirectory(): Promise<string> {
  return invoke<string>('get_log_dir');
}

/**
 * Open the log directory in file explorer
 */
export async function openLogDirectory(): Promise<void> {
  await invoke('open_log_dir');
}

/**
 * Get recent log entries
 */
export async function getRecentLogs(lines = 100): Promise<string> {
  return invoke<string>('get_recent_logs', { lines });
}

// ============================================================================
// Dev Mode - Automatic Console Interception & Event Logging
// ============================================================================

/**
 * Events to automatically log in dev mode
 * Note: Only logged from main window to avoid duplicates from overlay windows
 */
const EVENTS_TO_LOG = [
  'recording-state-changed',
  'recording-format',
  'capture-complete',
  'capture-complete-fast',
  'open-settings',
  // Excluded: 'reset-overlay' (fires for each monitor), 'selection-update' (too verbose)
];

/**
 * Enable dev mode logging:
 * - Intercepts all console.* calls
 * - Logs all Tauri events (main window only to avoid duplicates)
 * - Adds Ctrl+Shift+L shortcut to open logs
 */
export async function enableDevMode(): Promise<void> {
  if (devModeEnabled) return;
  devModeEnabled = true;

  const devLog = createLogger('Console');

  // Intercept console methods
  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    addLog('debug', 'Console', formatMessage(...args));
  };

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    addLog('debug', 'Console', formatMessage(...args));
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    addLog('info', 'Console', formatMessage(...args));
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    addLog('warn', 'Console', formatMessage(...args));
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    addLog('error', 'Console', formatMessage(...args));
  };

  // Only listen to Tauri events from main window to avoid duplicate logs
  // Overlay windows and recording controls windows skip event logging
  const isMainWindow = window.location.pathname === '/' || window.location.pathname === '/index.html';
  
  if (isMainWindow) {
    // Set up all event listeners in parallel for faster startup
    const listenerPromises = EVENTS_TO_LOG.map(async (eventName) => {
      try {
        const unlisten = await listen(eventName, (event) => {
          addLog('debug', 'Event', `${eventName}: ${formatMessage(event.payload)}`);
        });
        return unlisten;
      } catch (e) {
        devLog.warn(`Failed to listen to event ${eventName}:`, e);
        return null;
      }
    });

    const results = await Promise.all(listenerPromises);
    eventUnlisteners.push(...results.filter((fn): fn is UnlistenFn => fn !== null));
  }

  // Add keyboard shortcut to open logs (Ctrl+Shift+L)
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'L') {
      e.preventDefault();
      openLogDirectory().catch(console.error);
    }
  };
  window.addEventListener('keydown', handleKeyDown);

  // Log uncaught errors
  window.addEventListener('error', (event) => {
    addLog('error', 'Uncaught', `${event.message} at ${event.filename}:${event.lineno}`);
  });

  window.addEventListener('unhandledrejection', (event) => {
    addLog('error', 'UnhandledPromise', String(event.reason));
  });

  // Only log from main window to avoid duplicate "dev mode enabled" messages
  if (isMainWindow) {
    devLog.info('Dev mode enabled - Ctrl+Shift+L to open logs');
  }
}

/**
 * Disable dev mode logging
 */
export function disableDevMode(): void {
  if (!devModeEnabled) return;
  devModeEnabled = false;

  // Restore original console methods
  console.log = originalConsole.log;
  console.debug = originalConsole.debug;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;

  // Unsubscribe from events
  for (const unlisten of eventUnlisteners) {
    unlisten();
  }
  eventUnlisteners = [];
}

/**
 * Check if dev mode is enabled
 */
export function isDevModeEnabled(): boolean {
  return devModeEnabled;
}

/**
 * Initialize logging - call this once at app startup
 * Automatically enables dev mode in development builds
 */
export async function initializeLogging(): Promise<void> {
  // Always enable in dev, or check for debug flag in production
  if (import.meta.env.DEV) {
    await enableDevMode();
  }
  
  // Flush logs before page unload
  window.addEventListener('beforeunload', () => {
    flushAllLogs();
  });
}
