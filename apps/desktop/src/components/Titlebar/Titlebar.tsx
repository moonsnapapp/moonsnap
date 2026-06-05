import { useState, useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Minus, Square, X, Maximize2, Aperture, Sun, Moon, FolderOpen, Camera, Settings } from 'lucide-react';
import { useFocusedShortcutDispatch } from '@/hooks/useFocusedShortcutDispatch';
import { useTheme } from '@/hooks/useTheme';
import { UpdateAvailablePill } from '@/components/Updates/UpdateAvailablePill';

interface TitlebarProps {
  title?: string;
  showLogo?: boolean;
  showMaximize?: boolean;
  variant?: 'default' | 'hud';
  /** Short context label shown on the left in HUD mode. */
  contextLabel?: string;
  /** Secondary detail shown next to the context chip in HUD mode. */
  detailLabel?: string;
  /** Called before window closes. Return false to prevent close. */
  onClose?: () => void | boolean | Promise<void | boolean>;
  /** Called when library button is clicked. Button only shown if provided. */
  onOpenLibrary?: () => void;
  /** Called when capture button is clicked. Button only shown if provided. */
  onCapture?: () => void;
  /** Called when settings button is clicked. Button only shown if provided. */
  onOpenSettings?: () => void;
}

export const Titlebar: React.FC<TitlebarProps> = ({
  title = 'MoonSnap',
  showLogo = true,
  showMaximize = true,
  variant = 'default',
  contextLabel,
  detailLabel,
  onClose,
  onOpenLibrary,
  onCapture,
  onOpenSettings,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const appWindow = getCurrentWebviewWindow();
  const { resolvedTheme, toggleTheme } = useTheme();
  useFocusedShortcutDispatch();

  const isHud = variant === 'hud';
  const buttonClassName = `titlebar-button${isHud ? ' titlebar-button--hud' : ''}`;

  useEffect(() => {
    // Check initial maximized state
    appWindow.isMaximized().then(setIsMaximized);

    // Listen for window state changes - debounced to avoid excessive IPC during resize
    let debounceTimer: number | null = null;
    let unlistenFn: (() => void) | null = null;
    
    appWindow.onResized(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        appWindow.isMaximized().then(setIsMaximized);
      }, 150);
    }).then((fn) => {
      unlistenFn = fn;
    });

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (unlistenFn) unlistenFn();
    };
  }, [appWindow]);

  // Handle drag state
  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = async () => {
    if (onClose) {
      const result = await onClose();
      if (result === false) return; // Prevent close if callback returns false
    }
    appWindow.close();
  };

  return (
    <div
      data-tauri-drag-region
      className={`titlebar ${isHud ? 'titlebar--hud' : ''} ${isDragging ? 'titlebar-dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Left: Logo & Title */}
      <div
        className={`titlebar-left ${isHud ? 'titlebar-left--hud' : ''}`}
        data-tauri-drag-region
      >
        {isHud ? (
          <>
            <span className="titlebar-hud-context" data-tauri-drag-region>
              {contextLabel ?? 'Workspace'}
            </span>
            {detailLabel && (
              <span
                className="titlebar-hud-detail"
                title={detailLabel}
                data-tauri-drag-region
              >
                <span className="titlebar-hud-detail-label">
                  {detailLabel}
                </span>
              </span>
            )}
          </>
        ) : (
          <>
            {showLogo && (
              <div className="titlebar-logo">
                <Aperture className="w-3.5 h-3.5" />
              </div>
            )}
            <span className="titlebar-title" data-tauri-drag-region>
              {title}
            </span>
          </>
        )}
      </div>

      {/* Center: Drag Region / HUD Brand */}
      <div className="titlebar-center" data-tauri-drag-region>
        {isHud && (
          <div className="titlebar-hud-brand" data-tauri-drag-region>
            <span className="titlebar-hud-brand-wordmark" data-tauri-drag-region>
              {title}
            </span>
          </div>
        )}
      </div>

      {/* Right: Window Controls */}
      <div className={`titlebar-controls ${isHud ? 'titlebar-controls--hud' : ''}`}>
        {isHud && <UpdateAvailablePill variant="titlebar" />}
        {onCapture && (
          <button
            onClick={onCapture}
            className={buttonClassName}
            aria-label="New Capture"
            title="New Capture"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
        )}
        {onOpenLibrary && (
          <button
            onClick={onOpenLibrary}
            className={buttonClassName}
            aria-label="Open Library"
            title="Open Library"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className={buttonClassName}
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={toggleTheme}
          className={buttonClassName}
          aria-label={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {resolvedTheme === 'dark' ? (
            <Sun className="w-3.5 h-3.5" />
          ) : (
            <Moon className="w-3.5 h-3.5" />
          )}
        </button>

        <button
          onClick={handleMinimize}
          className={`${buttonClassName} titlebar-button-minimize`}
          aria-label="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        {showMaximize && (
          <button
            onClick={handleMaximize}
            className={`${buttonClassName} titlebar-button-maximize`}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
          >
            {isMaximized ? (
              <Maximize2 className="w-3 h-3" />
            ) : (
              <Square className="w-3 h-3" />
            )}
          </button>
        )}
        <button
          onClick={handleClose}
          className={`${buttonClassName} titlebar-button-close`}
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
