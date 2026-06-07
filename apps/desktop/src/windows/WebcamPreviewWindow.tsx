/**
 * WebcamPreviewWindow - Simple JPEG-based webcam preview.
 *
 * Polls for JPEG frames from Rust backend and displays them in an img tag.
 * Much simpler and often faster than GPU-based rendering.
 */

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow, LogicalSize } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { listen, emit } from '@tauri-apps/api/event';
import { X, Circle, Square, FlipHorizontal2, Maximize2, Minimize2 } from 'lucide-react';
import type { WebcamSettings, WebcamSize, WebcamShape } from '@/types/generated';
import { webcamLogger } from '@/utils/logger';

// Control bar height
const CONTROL_BAR_HEIGHT = 40;
// Gap between control bar and preview
const CONTROL_GAP = 8;
// Top padding to prevent clipping
const TOP_PADDING = 4;

// Preview circle size based on webcam size setting
const CIRCLE_SIZES: Record<WebcamSize, number> = {
  small: 160,
  large: 200,
};
const SQUIRCLE_RADIUS_RATIO = 0.4;
const DEFAULT_WEBCAM_SETTINGS: WebcamSettings = {
  enabled: true,
  deviceIndex: 0,
  position: { type: 'bottomRight' },
  size: 'small',
  shape: 'squircle',
  mirror: true,
};

interface MutableCurrent<T> {
  current: T;
}

function isRecordingState(type: string) {
  return type === 'Recording';
}

function isStoppedRecordingState(type: string) {
  return type === 'Idle' || type === 'Completed' || type === 'Error';
}

function useResizeWindowToContainer(containerRef: React.RefObject<HTMLDivElement | null>) {
  const lastSizeRef = useRef({ width: 0, height: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeWindow = async () => {
      const nextSize = getContainerResizeSize(container);
      if (!shouldResizeWebcamWindow(nextSize, lastSizeRef.current)) return;

      lastSizeRef.current = nextSize;

      try {
        await resizeCurrentWebcamWindow(nextSize);
      } catch (e) {
        webcamLogger.error('Failed to resize window:', e);
      }
    };

    resizeWindow();

    const observer = new ResizeObserver(() => {
      resizeWindow();
    });
    observer.observe(container);

    return () => observer.disconnect();
  }, [containerRef]);
}

function getContainerResizeSize(container: HTMLDivElement) {
  const rect = container.getBoundingClientRect();
  return {
    width: Math.ceil(rect.width),
    height: Math.ceil(rect.height),
  };
}

function shouldResizeWebcamWindow(
  nextSize: { width: number; height: number },
  lastSize: { width: number; height: number }
) {
  const hasSize = nextSize.width > 0 && nextSize.height > 0;
  const changed = nextSize.width !== lastSize.width || nextSize.height !== lastSize.height;
  return hasSize && changed;
}

async function resizeCurrentWebcamWindow({ width, height }: { width: number; height: number }) {
  const win = getCurrentWindow();
  await win.setSize(new LogicalSize(width, height));
  webcamLogger.debug(`Resized window to ${width}x${height}`);
}

function useInitialWebcamSettings(setSettings: React.Dispatch<React.SetStateAction<WebcamSettings>>) {
  useEffect(() => {
    const loadInitialSettings = async () => {
      try {
        const loaded = await invoke<WebcamSettings>('get_webcam_settings_cmd');
        setSettings(loaded);
      } catch (e) {
        webcamLogger.error('Failed to load settings:', e);
      }
    };
    loadInitialSettings();
  }, [setSettings]);
}

function shouldPollWebcamFrame(now: number, lastFrameTime: number, frameInterval: number) {
  return now - lastFrameTime >= frameInterval;
}

async function fetchWebcamPreviewFrame() {
  return invoke<string | null>('get_webcam_preview_frame', { quality: 75 });
}

function applyWebcamPreviewFrame(
  frame: string | null,
  mountedRef: MutableCurrent<boolean>,
  setImageSrc: React.Dispatch<React.SetStateAction<string | null>>
) {
  if (frame && mountedRef.current) {
    setImageSrc(`data:image/jpeg;base64,${frame}`);
  }
}

function scheduleWebcamFramePoll(
  mountedRef: MutableCurrent<boolean>,
  frameRequestRef: MutableCurrent<number | null>,
  pollFrame: () => void
) {
  if (mountedRef.current) {
    frameRequestRef.current = requestAnimationFrame(pollFrame);
  }
}

function cancelWebcamFramePoll(frameRequestRef: MutableCurrent<number | null>) {
  if (frameRequestRef.current) {
    cancelAnimationFrame(frameRequestRef.current);
  }
}

function useWebcamFramePolling(setImageSrc: React.Dispatch<React.SetStateAction<string | null>>) {
  const mountedRef = useRef(true);
  const frameRequestRef = useRef<number | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    let lastFrameTime = 0;
    const targetFps = 30;
    const frameInterval = 1000 / targetFps;

    const pollFrame = async () => {
      if (!mountedRef.current) return;

      const now = performance.now();
      if (shouldPollWebcamFrame(now, lastFrameTime, frameInterval)) {
        try {
          applyWebcamPreviewFrame(await fetchWebcamPreviewFrame(), mountedRef, setImageSrc);
          lastFrameTime = now;
        } catch {
          // Ignore transient polling errors while the camera stream starts/stops.
        }
      }

      scheduleWebcamFramePoll(mountedRef, frameRequestRef, pollFrame);
    };

    frameRequestRef.current = requestAnimationFrame(pollFrame);

    return () => {
      mountedRef.current = false;
      cancelWebcamFramePoll(frameRequestRef);
    };
  }, [setImageSrc]);
}

function useWebcamSettingsEvents(setSettings: React.Dispatch<React.SetStateAction<WebcamSettings>>) {
  useEffect(() => {
    const unlisten = listen<WebcamSettings>('webcam-settings-changed', (event) => {
      webcamLogger.debug('Settings changed:', event.payload);
      setSettings(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [setSettings]);
}

function useRecordingStateEvents(setIsRecording: React.Dispatch<React.SetStateAction<boolean>>) {
  useEffect(() => {
    const unlistenStart = listen('recording-state-changed', (event) => {
      const state = event.payload as { type: string };
      if (isRecordingState(state.type)) setIsRecording(true);
      else if (isStoppedRecordingState(state.type)) setIsRecording(false);
    });

    return () => {
      unlistenStart.then((fn) => fn()).catch(() => {});
    };
  }, [setIsRecording]);
}

function useWebcamCloseEvent() {
  useEffect(() => {
    const unlisten = listen('webcam-preview-close', async () => {
      webcamLogger.debug('Received close event');
      try {
        const win = getCurrentWindow();
        await win.close();
      } catch (e) {
        webcamLogger.error('Error closing window:', e);
      }
    });

    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);
}

interface WebcamControlsProps {
  visible: boolean;
  isCircle: boolean;
  mirror: boolean;
  size: WebcamSize;
  onToggleShape: () => void;
  onToggleMirror: () => void;
  onToggleSize: () => void;
  onClose: () => void;
}

function WebcamControlButton({
  title,
  opacity = 1,
  onClick,
  children,
}: {
  title: string;
  opacity?: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px',
        borderRadius: '6px',
        background: 'transparent',
        border: 'none',
        color: 'rgba(255, 255, 255, 0.8)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity,
      }}
      title={title}
    >
      {children}
    </button>
  );
}

function getControlsPanelStyle(visible: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '6px 10px',
    background: 'rgba(0, 0, 0, 0.9)',
    border: '1px solid rgba(255, 255, 255, 0.15)',
    borderRadius: '8px',
    opacity: visible ? 1 : 0,
    transform: visible ? 'translateY(0)' : 'translateY(-8px)',
    transition: 'opacity 0.2s, transform 0.2s',
  };
}

function getShapeControl(isCircle: boolean) {
  return {
    title: isCircle ? 'Switch to squircle' : 'Switch to circle',
    icon: isCircle ? <Square size={16} /> : <Circle size={16} />,
  };
}

function getMirrorControl(mirror: boolean) {
  return {
    title: mirror ? 'Disable mirror' : 'Enable mirror',
    opacity: mirror ? 1 : 0.5,
  };
}

function getSizeControl(size: WebcamSize) {
  return {
    title: size === 'small' ? 'Enlarge' : 'Shrink',
    icon: size === 'large' ? <Minimize2 size={16} /> : <Maximize2 size={16} />,
  };
}

function WebcamControls({
  visible,
  isCircle,
  mirror,
  size,
  onToggleShape,
  onToggleMirror,
  onToggleSize,
  onClose,
}: WebcamControlsProps) {
  const shapeControl = getShapeControl(isCircle);
  const mirrorControl = getMirrorControl(mirror);
  const sizeControl = getSizeControl(size);

  return (
    <div
      style={{
        height: `${CONTROL_BAR_HEIGHT}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={getControlsPanelStyle(visible)}>
        <WebcamControlButton
          title={shapeControl.title}
          onClick={onToggleShape}
        >
          {shapeControl.icon}
        </WebcamControlButton>
        <WebcamControlButton
          title={mirrorControl.title}
          opacity={mirrorControl.opacity}
          onClick={onToggleMirror}
        >
          <FlipHorizontal2 size={16} />
        </WebcamControlButton>
        <WebcamControlButton
          title={sizeControl.title}
          onClick={onToggleSize}
        >
          {sizeControl.icon}
        </WebcamControlButton>
        <WebcamControlButton title="Close preview" onClick={onClose}>
          <X size={16} />
        </WebcamControlButton>
      </div>
    </div>
  );
}

interface WebcamFeedProps {
  imageSrc: string | null;
  isRecording: boolean;
  mirror: boolean;
  circleSize: number;
  borderRadius: string;
  className: string;
}

function WebcamFeed({
  imageSrc,
  isRecording,
  mirror,
  circleSize,
  borderRadius,
  className,
}: WebcamFeedProps) {
  return (
    <div
      className={className}
      style={{
        width: `${circleSize}px`,
        height: `${circleSize}px`,
        overflow: 'hidden',
        background: '#000',
        borderRadius,
      }}
    >
      {imageSrc ? (
        <img
          className={className}
          src={imageSrc}
          alt="Webcam preview"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius,
            transform: mirror ? 'scaleX(-1)' : 'none',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
          draggable={false}
        />
      ) : (
        <div
          className={className}
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.5)',
            fontSize: '12px',
            borderRadius,
            pointerEvents: 'none',
          }}
        >
          Loading...
        </div>
      )}

      {isRecording && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: '#ef4444',
            animation: 'pulse 2s infinite',
            pointerEvents: 'none',
          }}
        />
      )}
    </div>
  );
}

const WebcamPreviewWindow: React.FC = () => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [settings, setSettings] = useState<WebcamSettings>(DEFAULT_WEBCAM_SETTINGS);

  const containerRef = useRef<HTMLDivElement>(null);

  useResizeWindowToContainer(containerRef);
  useInitialWebcamSettings(setSettings);
  useWebcamFramePolling(setImageSrc);
  useWebcamSettingsEvents(setSettings);
  useRecordingStateEvents(setIsRecording);
  useWebcamCloseEvent();

  // Close/hide the preview and disable webcam
  const handleClose = useCallback(async () => {
    try {
      await invoke('close_webcam_from_preview');
    } catch (e) {
      webcamLogger.error('Failed to close preview:', e);
    }
  }, []);

  // Toggle shape
  const handleToggleShape = useCallback(async () => {
    const newShape: WebcamShape = settings.shape === 'circle' ? 'squircle' : 'circle';
    try {
      await invoke('set_webcam_shape', { shape: newShape });
      const newSettings = { ...settings, shape: newShape };
      setSettings(newSettings);
      emit('webcam-settings-changed', newSettings);
    } catch (e) {
      webcamLogger.error('Failed to toggle shape:', e);
    }
  }, [settings]);

  // Toggle mirror
  const handleToggleMirror = useCallback(async () => {
    const newMirror = !settings.mirror;
    try {
      await invoke('set_webcam_mirror', { mirror: newMirror });
      const newSettings = { ...settings, mirror: newMirror };
      setSettings(newSettings);
      emit('webcam-settings-changed', newSettings);
    } catch (e) {
      webcamLogger.error('Failed to toggle mirror:', e);
    }
  }, [settings]);

  // Toggle size: small <-> large
  const handleToggleSize = useCallback(async () => {
    const newSize: WebcamSize = settings.size === 'small' ? 'large' : 'small';
    try {
      await invoke('set_webcam_size', { size: newSize });
      const newSettings = { ...settings, size: newSize };
      setSettings(newSettings);
      emit('webcam-settings-changed', newSettings);
      // Trigger anchor recalculation for new size
      if (settings.position.type !== 'custom') {
        emit('webcam-anchor-changed', { anchor: settings.position.type });
      }
    } catch (e) {
      webcamLogger.error('Failed to toggle size:', e);
    }
  }, [settings]);

  // Handle window dragging
  const handleMouseDown = useCallback(async (e: React.MouseEvent) => {
    // Don't drag if clicking on buttons
    if ((e.target as HTMLElement).closest('button')) {
      return;
    }
    try {
      const win = getCurrentWindow();
      await win.startDragging();
    } catch {
      // Ignore errors
    }
  }, []);

  const circleSize = CIRCLE_SIZES[settings.size];
  const isCircle = settings.shape === 'circle';
  const borderRadius = isCircle ? '50%' : `${Math.round(circleSize * SQUIRCLE_RADIUS_RATIO)}px`;
  const webcamShapeClassName = isCircle ? '' : 'webcam-preview-squircle';

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: `${circleSize}px`,
        paddingTop: `${TOP_PADDING}px`,
        cursor: 'move',
        gap: `${CONTROL_GAP}px`,
      }}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <WebcamControls
        visible={isHovered && !isRecording}
        isCircle={isCircle}
        mirror={settings.mirror}
        size={settings.size}
        onToggleShape={handleToggleShape}
        onToggleMirror={handleToggleMirror}
        onToggleSize={handleToggleSize}
        onClose={handleClose}
      />

      <WebcamFeed
        imageSrc={imageSrc}
        isRecording={isRecording}
        mirror={settings.mirror}
        circleSize={circleSize}
        borderRadius={borderRadius}
        className={webcamShapeClassName}
      />
    </div>
  );
};

export default WebcamPreviewWindow;
