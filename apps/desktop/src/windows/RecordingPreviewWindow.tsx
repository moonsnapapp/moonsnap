/**
 * RecordingPreviewWindow - floating mini preview after recording completes.
 *
 * Appears in the bottom-right corner with recording info and action buttons.
 * Auto-dismisses after a timeout. Clicking opens the video editor.
 */

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

const AUTO_DISMISS_MS = 5000;
const SLIDE_DURATION_MS = 300;

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
  const [isHovered, setIsHovered] = useState(false);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Trigger slide-in on mount
  useEffect(() => {
    if (!outputPath) return;
    requestAnimationFrame(() => {
      setIsVisible(true);
    });
  }, [outputPath]);

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

  // Pause timer on hover
  useEffect(() => {
    if (isHovered && dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current);
    } else if (!isHovered && isVisible) {
      resetDismissTimer();
    }
  }, [isHovered, isVisible, resetDismissTimer]);

  const handleOpenEditor = useCallback(async () => {
    try {
      await invoke('show_video_editor_window', { projectPath: videoFilePath });
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

  // Drag support
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
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
        {/* Thumbnail */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            overflow: 'hidden',
            background: '#000',
          }}
        >
          {isGif ? (
            <img
              src={videoSrc}
              alt=""
              style={{
                width: '100%',
                height: 'auto',
                maxHeight: 160,
                objectFit: 'contain',
                display: 'block',
              }}
            />
          ) : (
            <video
              src={videoSrc}
              muted
              playsInline
              preload="auto"
              style={{
                width: '100%',
                height: 'auto',
                maxHeight: 160,
                objectFit: 'contain',
                display: 'block',
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
