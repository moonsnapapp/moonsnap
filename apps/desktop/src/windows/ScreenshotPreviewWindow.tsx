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

interface RgbaThumbnail {
  width: number;
  height: number;
  data: ImageDataArray;
}

function getScreenshotPreviewTransform(isVisible: boolean, isExiting: boolean) {
  if (isExiting) return 'translateX(360px)';
  return isVisible ? 'translateX(0)' : 'translateX(360px)';
}

function getScreenshotPreviewOpacity(isVisible: boolean, isExiting: boolean) {
  if (isExiting) return 0;
  return isVisible ? 1 : 0;
}

function isButtonEventTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return element?.tagName === 'BUTTON' || Boolean(element?.closest('button'));
}

function shouldStartPreviewDrag(
  start: { x: number; y: number } | null,
  dragStarted: boolean,
  event: React.MouseEvent<HTMLDivElement>
) {
  return Boolean(start) && !dragStarted && hasMovedPastPreviewDragThreshold(start, event);
}

function hasMovedPastPreviewDragThreshold(
  start: { x: number; y: number } | null,
  event: React.MouseEvent<HTMLDivElement>
) {
  if (!start) return false;

  const dx = event.clientX - start.x;
  const dy = event.clientY - start.y;
  const DRAG_THRESHOLD_PX = 4;
  return dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
}

function shouldOpenEditorFromPreviewMouseUp(
  start: { x: number; y: number } | null,
  dragStarted: boolean,
  event: React.MouseEvent<HTMLDivElement>
) {
  return Boolean(start) && !dragStarted && !isButtonEventTarget(event.target);
}

function decodeRgbaThumbnail(buffer: ArrayBuffer): RgbaThumbnail {
  const view = new DataView(buffer);
  return {
    width: view.getUint32(0, true),
    height: view.getUint32(4, true),
    data: new Uint8ClampedArray(buffer, 8),
  };
}

function paintRgbaThumbnail(
  canvas: HTMLCanvasElement,
  thumbnail: RgbaThumbnail
): boolean {
  canvas.width = thumbnail.width;
  canvas.height = thumbnail.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return false;
  }

  const imageData = new ImageData(thumbnail.data, thumbnail.width, thumbnail.height);
  ctx.putImageData(imageData, 0, 0);
  return true;
}

function revealScreenshotPreview(
  setIsVisible: (visible: boolean) => void,
  isVisibleRef: React.MutableRefObject<boolean>
): void {
  requestAnimationFrame(() => {
    setIsVisible(true);
    isVisibleRef.current = true;
  });
}

async function paintScreenshotThumbnailFile(
  filePath: string,
  canvas: HTMLCanvasElement | null,
  isCancelled: () => boolean
): Promise<boolean> {
  const data = await readFile(filePath);
  const thumbnail = decodeRgbaThumbnail(data.buffer);

  if (!canvas || isCancelled()) {
    return false;
  }

  return paintRgbaThumbnail(canvas, thumbnail) && !isCancelled();
}

function closeScreenshotPreviewIfActive(
  isCancelled: () => boolean,
  closePreview: () => void
): void {
  if (!isCancelled()) {
    closePreview();
  }
}

async function loadScreenshotThumbnail({
  filePath,
  canvas,
  isCancelled,
  setIsVisible,
  isVisibleRef,
  closePreview,
}: {
  filePath: string;
  canvas: HTMLCanvasElement | null;
  isCancelled: () => boolean;
  setIsVisible: (visible: boolean) => void;
  isVisibleRef: React.MutableRefObject<boolean>;
  closePreview: () => void;
}): Promise<void> {
  try {
    const painted = await paintScreenshotThumbnailFile(filePath, canvas, isCancelled);
    if (!painted) return;

    revealScreenshotPreview(setIsVisible, isVisibleRef);
  } catch {
    closeScreenshotPreviewIfActive(isCancelled, closePreview);
  }
}

function ScreenshotThumbnail({
  canvasRef,
  onDelete,
  onDismiss,
}: {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onDelete: () => void;
  onDismiss: () => void;
}) {
  return (
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
      <ActionButton
        onClick={onDelete}
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
      <ActionButton
        onClick={onDismiss}
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
  );
}

function ScreenshotCopyStatus({
  copied,
  copyFeedbackKey,
  prefersReducedMotion,
}: {
  copied: boolean;
  copyFeedbackKey: number;
  prefersReducedMotion: boolean;
}) {
  const capturedStyle = getScreenshotCapturedStatusStyle(copied, prefersReducedMotion);

  return (
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
        style={capturedStyle}
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
  );
}

function getScreenshotCapturedStatusStyle(
  copied: boolean,
  prefersReducedMotion: boolean
): React.CSSProperties {
  return {
    ...getScreenshotStatusTextBaseStyle(),
    color: 'var(--ink-black)',
    opacity: copied ? 0 : 0.6,
    transform: copied ? 'translateY(-8px)' : 'translateY(0)',
    transition: getScreenshotCopyTransition(prefersReducedMotion),
  };
}

function getScreenshotStatusTextBaseStyle(): React.CSSProperties {
  return {
    position: 'absolute',
    inset: 0,
    fontSize: 12,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  };
}

function getScreenshotCopyTransition(prefersReducedMotion: boolean) {
  return prefersReducedMotion
    ? 'none'
    : 'transform 180ms cubic-bezier(0.215, 0.61, 0.355, 1), opacity 180ms cubic-bezier(0.215, 0.61, 0.355, 1)';
}

function ScreenshotActionBar({
  copied,
  copyFeedbackKey,
  prefersReducedMotion,
  onCopy,
  onOpenEditor,
}: {
  copied: boolean;
  copyFeedbackKey: number;
  prefersReducedMotion: boolean;
  onCopy: () => void;
  onOpenEditor: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
      }}
    >
      <ScreenshotCopyStatus
        copied={copied}
        copyFeedbackKey={copyFeedbackKey}
        prefersReducedMotion={prefersReducedMotion}
      />

      <ActionButton onClick={onCopy} title="Copy to clipboard">
        {copied ? <CheckIcon /> : <CopyIcon />}
      </ActionButton>

      <ActionButton onClick={onOpenEditor} title="Open in editor">
        <EditIcon />
      </ActionButton>
    </div>
  );
}

function ScreenshotAutoDismissProgress({
  isVisible,
  timerPaused,
}: {
  isVisible: boolean;
  timerPaused: boolean;
}) {
  return (
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
  );
}

async function getCursorInsideCurrentWindow() {
  const currentWindow = getCurrentWindow();
  const [cursor, position, size] = await Promise.all([
    cursorPosition(),
    currentWindow.outerPosition(),
    currentWindow.outerSize(),
  ]);

  return (
    cursor.x >= position.x &&
    cursor.x < position.x + size.width &&
    cursor.y >= position.y &&
    cursor.y < position.y + size.height
  );
}

function applyCursorTimerState({
  isInside,
  isCursorInsideRef,
  isVisibleRef,
  pauseTimer,
  startTimer,
}: {
  isInside: boolean;
  isCursorInsideRef: React.MutableRefObject<boolean>;
  isVisibleRef: React.MutableRefObject<boolean>;
  pauseTimer: () => void;
  startTimer: () => void;
}) {
  if (isInside === isCursorInsideRef.current) {
    return;
  }

  isCursorInsideRef.current = isInside;
  if (isInside) {
    pauseTimer();
    return;
  }

  if (isVisibleRef.current) {
    startTimer();
  }
}

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
      const isInside = await getCursorInsideCurrentWindow();
      applyCursorTimerState({
        isInside,
        isCursorInsideRef,
        isVisibleRef,
        pauseTimer,
        startTimer,
      });
    } catch {
      // Ignore cursor sync failures and preserve current timer state.
    }
  }, [pauseTimer, startTimer]);

  // Load thumbnail from RGBA file
  useEffect(() => {
    if (!filePath) return;

    let cancelled = false;

    void loadScreenshotThumbnail({
      filePath,
      canvas: canvasRef.current,
      isCancelled: () => cancelled,
      setIsVisible,
      isVisibleRef,
      closePreview,
    });

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
      await emit('preview-open-library-image-editor', {
        originalPath: filePath,
        projectId: savedProjectId,
      });
    } catch {
      // Ignore errors
    }
    closePreview();
  }, [filePath, savedProjectId, closePreview]);

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
    if (!shouldStartPreviewDrag(start, dragStartedRef.current, e)) return;

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
    if (!shouldOpenEditorFromPreviewMouseUp(start, dragStartedRef.current, e)) return;

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
          transform: getScreenshotPreviewTransform(isVisible, isExiting),
          opacity: getScreenshotPreviewOpacity(isVisible, isExiting),
          transition: `transform ${SLIDE_DURATION_MS}ms cubic-bezier(0.16, 1, 0.3, 1), opacity ${SLIDE_DURATION_MS}ms ease`,
          cursor: 'default',
          userSelect: 'none',
          WebkitUserSelect: 'none',
        }}
      >
        <ScreenshotThumbnail
          canvasRef={canvasRef}
          onDelete={handleDelete}
          onDismiss={handleDismiss}
        />

        <ScreenshotActionBar
          copied={copied}
          copyFeedbackKey={copyFeedbackKey}
          prefersReducedMotion={prefersReducedMotion}
          onCopy={handleCopy}
          onOpenEditor={handleOpenEditor}
        />

        <ScreenshotAutoDismissProgress
          isVisible={isVisible}
          timerPaused={timerPaused}
        />
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

interface ActionButtonProps {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  hoverBackground?: string;
}

function getActionButtonStyle({
  hovered,
  extraStyle,
  hoverBackground,
}: {
  hovered: boolean;
  extraStyle?: React.CSSProperties;
  hoverBackground?: string;
}): React.CSSProperties {
  const background = getActionButtonBackground(hovered, extraStyle, hoverBackground);

  return {
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    borderRadius: 6,
    background,
    color: 'var(--ink-black)',
    cursor: 'pointer',
    transition: 'background 150ms ease',
    padding: 0,
    flexShrink: 0,
    ...extraStyle,
  };
}

function getActionButtonBackground(
  hovered: boolean,
  extraStyle?: React.CSSProperties,
  hoverBackground?: string
) {
  return hovered ? getActionButtonHoverBackground(hoverBackground) : getActionButtonDefaultBackground(extraStyle);
}

function getActionButtonHoverBackground(hoverBackground?: string) {
  return hoverBackground ?? 'var(--polar-frost)';
}

function getActionButtonDefaultBackground(extraStyle?: React.CSSProperties) {
  return extraStyle?.background ?? 'transparent';
}

function ActionButton({
  onClick,
  title,
  children,
  style: extraStyle,
  hoverBackground,
}: ActionButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={getActionButtonStyle({ hovered, extraStyle, hoverBackground })}
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
