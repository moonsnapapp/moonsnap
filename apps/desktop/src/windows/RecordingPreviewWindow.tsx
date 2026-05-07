/**
 * RecordingPreviewWindow - floating mini preview after recording completes.
 *
 * Appears in the bottom-right corner with recording info and action buttons.
 * Auto-dismisses after a timeout. Clicking opens the video editor.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { cursorPosition, getCurrentWindow } from '@tauri-apps/api/window';

const AUTO_DISMISS_MS = 5000;
const SLIDE_DURATION_MS = 300;
const CURSOR_SYNC_MS = 100;

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RecordingPreviewWindow() {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [timerPaused, setTimerPaused] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isVisibleRef = useRef(false);
  const isCursorInsideRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartedRef = useRef(false);

  const params = new URLSearchParams(window.location.search);
  const outputPath = params.get('path') || '';
  const durationSecs = parseFloat(params.get('duration') || '0');
  const fileSizeBytes = parseInt(params.get('size') || '0', 10);

  const isGif = outputPath.toLowerCase().endsWith('.gif');
  const formatLabel = isGif ? 'GIF' : 'Video';

  // Resolve the video file path for the thumbnail
  const videoFilePath = useMemo(() => {
    const hasExtension = /\.\w+$/.test(outputPath);
    return hasExtension ? outputPath : `${outputPath}/screen.mp4`;
  }, [outputPath]);
  const videoSrc = useMemo(() => convertFileSrc(videoFilePath), [videoFilePath]);

  const closePreview = useCallback(() => {
    setIsExiting(true);
    setTimeout(() => {
      invoke('close_recording_preview').catch(() => {});
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

  // Trigger slide-in on mount
  useEffect(() => {
    if (!outputPath) return;
    requestAnimationFrame(() => {
      setIsVisible(true);
      isVisibleRef.current = true;
    });
  }, [outputPath]);

  // Start auto-dismiss timer when first visible
  useEffect(() => {
    if (!isVisible) return;
    startTimer();
    return () => {
      if (dismissTimerRef.current) {
        clearTimeout(dismissTimerRef.current);
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

  const handleOpenEditor = useCallback(async () => {
    try {
      await emit('preview-open-library-video-editor', { videoPath: videoFilePath });
    } catch {
      // Ignore
    }
    closePreview();
  }, [videoFilePath, closePreview]);

  const handleRevealInFolder = useCallback(async () => {
    try {
      await invoke('reveal_file_in_explorer', { path: outputPath });
    } catch {
      // Ignore
    }
  }, [outputPath]);

  const handleOpenMedia = useCallback(async () => {
    try {
      await invoke('open_file_with_default_app', { path: outputPath });
    } catch {
      // Ignore
    }
  }, [outputPath]);

  const handleDelete = useCallback(async () => {
    try {
      // Extract project ID (folder name) from the output path
      const projectId = outputPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
      if (projectId) {
        await invoke('delete_project', { projectId });
        await emit('capture-deleted', { projectId });
      }
    } catch {
      // Ignore
    }
    closePreview();
  }, [outputPath, closePreview]);

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
    if (!start || dragStartedRef.current || isGif) return;

    const target = e.target as HTMLElement;
    if (target.tagName === 'BUTTON' || target.closest('button')) return;

    void handleOpenEditor();
  }, [handleOpenEditor, isGif]);

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
          flexDirection: 'column',
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
        {/* Thumbnail */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {isGif ? (
            <img
              src={videoSrc}
              alt=""
              draggable={false}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                display: 'block',
                pointerEvents: 'none',
              }}
            />
          ) : (
            <video
              src={videoSrc}
              muted
              playsInline
              preload="auto"
              draggable={false}
              style={{
                maxWidth: '100%',
                maxHeight: '100%',
                objectFit: 'contain',
                display: 'block',
                pointerEvents: 'none',
              }}
            />
          )}
          {/* Duration badge */}
          <div
            style={{
              position: 'absolute',
              bottom: 6,
              left: 6,
              background: 'rgba(0,0,0,0.6)',
              color: '#fff',
              fontSize: 10,
              fontWeight: 600,
              padding: '2px 6px',
              borderRadius: 4,
              pointerEvents: 'none',
            }}
          >
            {formatDuration(durationSecs)}
          </div>
          {/* Delete button - top left */}
          <ActionButton
            onClick={handleDelete}
            title="Delete recording"
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
            onClick={closePreview}
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
            {formatLabel} recorded &middot; {formatFileSize(fileSizeBytes)}
          </span>

          <ActionButton onClick={handleRevealInFolder} title="Show in folder">
            <FolderIcon />
          </ActionButton>

          {isGif ? (
            <ActionButton onClick={handleOpenMedia} title="Open GIF">
              <PlayIcon />
            </ActionButton>
          ) : (
            <ActionButton onClick={handleOpenEditor} title="Open in editor">
              <EditIcon />
            </ActionButton>
          )}
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
        ...(hovered ? { background: hoverBg } : {}),
      }}
    >
      {children}
    </button>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3" />
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

export default RecordingPreviewWindow;
