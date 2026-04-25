/**
 * ScreenshotPreviewWindow - macOS-style mini preview after screenshot capture.
 *
 * Appears in the bottom-right corner with a thumbnail and action buttons.
 * Auto-dismisses after a timeout. Clicking the thumbnail opens the editor.
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { readFile } from '@tauri-apps/plugin-fs';
import { cursorPosition, getCurrentWindow } from '@tauri-apps/api/window';
import { copyCanvasToClipboard } from '@/utils/canvasExport';

const AUTO_DISMISS_MS = 5000;
const SLIDE_DURATION_MS = 300;
const CURSOR_SYNC_MS = 100;
const COPY_FEEDBACK_MS = 1600;

function ScreenshotPreviewWindow() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFeedbackKey, setCopyFeedbackKey] = useState(0);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisibleRef = useRef(false);
  const isCursorInsideRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);

  // Parse query params
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get('path') || '';
  const imgWidth = parseInt(params.get('w') || '0', 10);
  const imgHeight = parseInt(params.get('h') || '0', 10);
  const shouldAutoCopyOnOpen = params.get('autoCopy') === '1';
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const closePreview = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      invoke('close_screenshot_preview').catch(() => {});
    }, SLIDE_DURATION_MS);
  }, []);

  const pauseTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
    }
    setTimerPaused(true);
  }, []);

  const startTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      closePreview();
    }, AUTO_DISMISS_MS);
    setTimerPaused(false);
  }, [closePreview]);

  const triggerCopyFeedback = useCallback(() => {
    if (copyFeedbackTimerRef.current) {
      clearTimeout(copyFeedbackTimerRef.current);
    }

    setCopied(true);
    setCopyFeedbackKey((current) => current + 1);

    copyFeedbackTimerRef.current = setTimeout(() => {
      setCopied(false);
      copyFeedbackTimerRef.current = null;
    }, COPY_FEEDBACK_MS);
  }, []);

  const syncTimerFromCursor = useCallback(async () => {
    try {
      const window = getCurrentWindow();
      const [cursor, position, size] = await Promise.all([
        cursorPosition(),
        window.outerPosition(),
        window.outerSize(),
      ]);

      const isInside =
        cursor.x >= position.x &&
        cursor.x < position.x + size.width &&
        cursor.y >= position.y &&
        cursor.y < position.y + size.height;

      if (isInside === isCursorInsideRef.current) {
        return;
      }

      isCursorInsideRef.current = isInside;
      if (isInside) {
        pauseTimer();
      } else if (isVisibleRef.current) {
        startTimer();
      }
    } catch {
      // Ignore cursor sync failures and preserve current timer state.
    }
  }, [pauseTimer, startTimer]);

  // Load thumbnail from RGBA file
  useEffect(() => {
    if (!filePath) return;

    let cancelled = false;

    async function loadThumbnail() {
      try {
        const data = await readFile(filePath);
        const buffer = data.buffer;
        const view = new DataView(buffer);

        const w = view.getUint32(0, true);
        const h = view.getUint32(4, true);
        const rgbaData = new Uint8ClampedArray(buffer, 8);

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const imageData = new ImageData(rgbaData, w, h);
        ctx.putImageData(imageData, 0, 0);

        if (!cancelled) {
          // Trigger slide-in animation
          requestAnimationFrame(() => {
            setIsVisible(true);
            isVisibleRef.current = true;
          });
        }
      } catch {
        // If we can't load the thumbnail, just close
        if (!cancelled) {
          closePreview();
        }
      }
    }

    loadThumbnail();

    return () => {
      cancelled = true;
    };
  }, [filePath, closePreview]);

  // Start auto-dismiss timer when first visible
  useEffect(() => {
    if (!isVisible) return;
    startTimer();
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
      if (copyFeedbackTimerRef.current) {
        clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, [isVisible, startTimer]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const intervalId = setInterval(() => {
      void syncTimerFromCursor();
    }, CURSOR_SYNC_MS);

    void syncTimerFromCursor();

    return () => {
      clearInterval(intervalId);
    };
  }, [isVisible, syncTimerFromCursor]);

  // Listen for save completion to track the project ID
  useEffect(() => {
    const unlisten = listen<{ originalPath: string; imagePath: string; projectId: string }>(
      'capture-saved',
      (event) => {
        if (event.payload.originalPath === filePath) {
          setSavedProjectId(event.payload.projectId);
        }
      }
    );

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [filePath]);

  // Listen for new captures - close current preview
  useEffect(() => {
    const unlisten = listen('capture-complete-fast', () => {
      // New capture coming, close this preview immediately
      invoke('close_screenshot_preview').catch(() => {});
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  const handleOpenEditor = useCallback(async () => {
    try {
      await invoke('show_image_editor_window', { capturePath: filePath });
      // Emit event so library window knows to save
      await emit('preview-open-editor', { file_path: filePath, width: imgWidth, height: imgHeight });
    } catch {
      // Ignore errors
    }
    closePreview();
  }, [filePath, imgWidth, imgHeight, closePreview]);

  const copyPreviewToClipboard = useCallback(async () => {
    try {
      if (canvasRef.current) {
        await copyCanvasToClipboard(canvasRef.current);
      } else {
        await invoke('copy_rgba_to_clipboard', { filePath });
      }
      triggerCopyFeedback();
    } catch {
      // Ignore errors
    }
  }, [filePath, triggerCopyFeedback]);

  useEffect(() => {
    if (!isVisible || !shouldAutoCopyOnOpen) {
      return;
    }

    void copyPreviewToClipboard();
  }, [copyPreviewToClipboard, isVisible, shouldAutoCopyOnOpen]);

  const handleCopy = useCallback(async () => {
    await copyPreviewToClipboard();
  }, [copyPreviewToClipboard]);

  const handleDelete = useCallback(async () => {
    try {
      // Clean up the temp RGBA file
      await invoke('cleanup_rgba_file', { filePath });
      // Delete the saved project if it exists
      if (savedProjectId) {
        await invoke('delete_project', { projectId: savedProjectId });
        await emit('capture-deleted', { projectId: savedProjectId });
      }
    } catch {
      // Ignore errors
    }
    closePreview();
  }, [filePath, savedProjectId, closePreview]);

  const handleDismiss = useCallback(() => {
    closePreview();
  }, [closePreview]);

  // Disable right-click context menu
  useEffect(() => {
    const handler = (e: MouseEvent) => e.preventDefault();
    document.addEventListener('contextmenu', handler);
    return () => document.removeEventListener('contextmenu', handler);
  }, []);

  const handlePreviewMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button')) return;
    if (e.button !== 0) return;

    // Prevent native HTML drag/select behavior from competing with Tauri window dragging.
    e.preventDefault();

    dragStartRef.current = { x: e.clientX, y: e.clientY };
    dragStartedRef.current = false;
  }, []);

  const handlePreviewMouseMove = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    if (!start || dragStartedRef.current) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const DRAG_THRESHOLD_PX = 4;
    if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;

    dragStartedRef.current = true;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Ignore drag failures.
    }
  }, []);

  const handlePreviewMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || dragStartedRef.current) return;

    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button')) return;

    void handleOpenEditor();
  }, [handleOpenEditor]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
      }}
    >
      <div
        onMouseDown={handlePreviewMouseDown}
        onMouseMove={(e) => {
          void handlePreviewMouseMove(e);
        }}
        onMouseUp={handlePreviewMouseUp}
        onDragStart={(e) => {
          e.preventDefault();
        }}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column' as const,
          background: 'var(--card)',
          borderRadius: 12,
          overflow: 'hidden',
          filter: 'drop-shadow(0 8px 32px rgba(0,0,0,0.25))',
          border: '1px solid var(--polar-frost)',
          transform: isExiting
            ? 'translateX(360px)'
            : isVisible
              ? 'translateX(0)'
              : 'translateX(360px)',
          opacity: isExiting ? 0 : isVisible ? 1 : 0,
          transition: `transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${SLIDE_DURATION_MS}ms ease`,
          cursor: 'default',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        {/* Thumbnail + close button */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            background: 'var(--polar-snow)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <canvas
            ref={canvasRef}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              display: 'block',
              pointerEvents: 'none',
            }}
          />
          {/* Delete button - top left */}
          <ActionButton
            onClick={handleDelete}
            title="Delete screenshot"
            style={{
              position: 'absolute',
              top: 6,
              left: 6,
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
            }}
            hoverBackground="rgba(220,38,38,0.8)"
          >
            <TrashIcon />
          </ActionButton>
          {/* Close button - top right */}
          <ActionButton
            onClick={handleDismiss}
            title="Dismiss"
            style={{
              position: 'absolute',
              top: 6,
              right: 6,
              background: 'rgba(0,0,0,0.5)',
              color: '#fff',
            }}
            hoverBackground="rgba(220,38,38,0.8)"
          >
            <CloseIcon />
          </ActionButton>
        </div>

        {/* Action bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '8px 10px',
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              position: 'relative',
              height: 18,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                position: 'absolute',
                inset: 0,
                fontSize: 12,
                color: 'var(--ink-black)',
                opacity: copied ? 0 : 0.6,
                transform: copied ? 'translateY(-8px)' : 'translateY(0)',
                transition: prefersReducedMotion
                  ? 'none'
                  : 'transform 180ms cubic-bezier(0.215, 0.61, 0.355, 1), opacity 180ms cubic-bezier(0.215, 0.61, 0.355, 1)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              Screenshot captured
            </span>

            {copied && (
              <span
                key={copyFeedbackKey}
                className="screenshot-preview__copy-feedback"
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  fontSize: 12,
                  color: 'var(--success)',
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Copied to clipboard
              </span>
            )}
          </div>

          <ActionButton
            onClick={handleCopy}
            title="Copy to clipboard"
          >
            {copied ? (
              <CheckIcon />
            ) : (
              <CopyIcon />
            )}
          </ActionButton>

          <ActionButton
            onClick={handleOpenEditor}
            title="Open in editor"
          >
            <EditIcon />
          </ActionButton>
        </div>

        {/* Auto-dismiss progress bar */}
        <div
          style={{
            height: 2,
            background: 'var(--polar-frost)',
            overflow: 'hidden',
          }}
        >
          {isVisible && !timerPaused && (
            <div
              style={{
                height: '100%',
                background: 'var(--primary, #6366f1)',
                animation: `shrink ${AUTO_DISMISS_MS}ms linear forwards`,
              }}
            />
          )}
        </div>
      </div>

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }

        @keyframes screenshot-preview-copy-feedback {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .screenshot-preview__copy-feedback {
          animation: screenshot-preview-copy-feedback 220ms cubic-bezier(0.215, 0.61, 0.355, 1);
        }

        @media (prefers-reduced-motion: reduce) {
          .screenshot-preview__copy-feedback {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}

function ActionButton({
  onClick,
  title,
  children,
  style: extraStyle,
  hoverBackground,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  hoverBackground?: string;
}) {
  const [hovered, setHovered] = useState(false);

  const defaultBg = extraStyle?.background ?? 'transparent';
  const hoverBg = hoverBackground ?? 'var(--polar-frost)';

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: 6,
        background: hovered ? hoverBg : defaultBg,
        color: 'var(--ink-black)',
        cursor: 'pointer',
        transition: 'background 150ms ease',
        padding: 0,
        flexShrink: 0,
        ...extraStyle,
        // Override background after spread so hover logic wins
        ...(hovered ? { background: hoverBg } : {}),
      }}
    >
      {children}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

export default ScreenshotPreviewWindow;
