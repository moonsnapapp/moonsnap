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
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const AUTO_DISMISS_MS = 5000;
const SLIDE_DURATION_MS = 300;

function ScreenshotPreviewWindow() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [copied, setCopied] = useState(false);
  const [savedProjectId, setSavedProjectId] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Parse query params
  const params = new URLSearchParams(window.location.search);
  const filePath = params.get('path') || '';
  const imgWidth = parseInt(params.get('w') || '0', 10);
  const imgHeight = parseInt(params.get('h') || '0', 10);

  const closePreview = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      invoke('close_screenshot_preview').catch(() => {});
    }, SLIDE_DURATION_MS);
  }, []);

  const resetDismissTimer = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    }
    dismissTimerRef.current = setTimeout(() => {
      if (!isHovered) {
        closePreview();
      }
    }, AUTO_DISMISS_MS);
  }, [isHovered, closePreview]);

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

  // Auto-dismiss timer
  useEffect(() => {
    if (!isVisible) return;
    resetDismissTimer();
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
      }
    };
  }, [isVisible, resetDismissTimer]);

  // Pause timer on hover, resume on leave
  useEffect(() => {
    if (isHovered && dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    } else if (!isHovered && isVisible) {
      resetDismissTimer();
    }
  }, [isHovered, isVisible, resetDismissTimer]);

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

  const handleCopy = useCallback(async () => {
    try {
      await invoke('copy_rgba_to_clipboard', { filePath });
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Ignore errors
    }
  }, [filePath]);

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

  // Drag support - allow dragging the preview window
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      // Only drag from the thumbnail area, not buttons
      const target = e.target as HTMLElement;
      if (target.tagName === 'BUTTON' || target.closest('button')) return;
      getCurrentWebviewWindow().startDragging().catch(() => {});
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
      }}
    >
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
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
          <span
            style={{
              fontSize: 12,
              color: 'var(--ink-black)',
              opacity: 0.6,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            Screenshot captured
          </span>

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
        {isVisible && !isHovered && (
          <div
            style={{
              height: 2,
              background: 'var(--polar-frost)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                height: '100%',
                background: 'var(--primary, #6366f1)',
                animation: `shrink ${AUTO_DISMISS_MS}ms linear forwards`,
              }}
            />
          </div>
        )}
      </div>

      <style>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
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
