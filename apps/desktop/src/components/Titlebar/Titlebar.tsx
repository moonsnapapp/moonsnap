import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Minus, Square, X, Maximize2, Aperture, Sun, Moon, FolderOpen, Camera, Settings } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { useLicenseStore } from '@/stores/licenseStore';

interface TitlebarProps {
  title?: string;
  showLogo?: boolean;
  showMaximize?: boolean;
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
  onClose,
  onOpenLibrary,
  onCapture,
  onOpenSettings,
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const appWindow = getCurrentWebviewWindow();
  const { resolvedTheme, toggleTheme } = useTheme();
  const licenseStatus = useLicenseStore((s) => s.status);
  const trialDaysLeft = useLicenseStore((s) => s.trialDaysLeft);
  const fetchLicenseStatus = useLicenseStore((s) => s.fetchStatus);

  const badgeLabel = licenseStatus === 'pro'
    ? 'Pro'
    : licenseStatus === 'trial' && trialDaysLeft !== null
      ? `${trialDaysLeft} day${trialDaysLeft === 1 ? '' : 's'} left`
      : licenseStatus === 'free' || licenseStatus === 'expired'
        ? 'Free'
        : null;

  const badgeClass = licenseStatus === 'pro'
    ? 'bg-[#3d1f1f] text-rose-400 border-[#5c2e2e]'
    : licenseStatus === 'trial'
      ? 'bg-[#3d2f1a] text-amber-400 border-[#5c4528]'
      : 'bg-[#2a2a2e] text-zinc-400 border-[#3a3a3f]';

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

  useEffect(() => {
    void fetchLicenseStatus();
  }, [fetchLicenseStatus]);

  useEffect(() => {
    const refreshLicenseStatus = () => {
      void fetchLicenseStatus();
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        refreshLicenseStatus();
      }
    };

    window.addEventListener('focus', refreshLicenseStatus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', refreshLicenseStatus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [fetchLicenseStatus]);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    listen('license-status-changed', () => {
      void fetchLicenseStatus();
    }).then((fn) => {
      unlistenFn = fn;
    }).catch((error) => {
      console.error('Failed to listen for license-status-changed:', error);
    });

    return () => {
      unlistenFn?.();
    };
  }, [fetchLicenseStatus]);

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
      className={`titlebar ${isDragging ? 'titlebar-dragging' : ''}`}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Left: Logo & Title */}
      <div className="titlebar-left" data-tauri-drag-region>
        {showLogo && (
          <div className="titlebar-logo">
            <Aperture className="w-3.5 h-3.5" />
          </div>
        )}
        <span className="titlebar-title" data-tauri-drag-region>
          {title}
        </span>
        {badgeLabel && (
          <span className={`titlebar-badge ${badgeClass}`}>
            {badgeLabel}
          </span>
        )}
      </div>

      {/* Center: Drag Region */}
      <div className="titlebar-center" data-tauri-drag-region />

      {/* Right: Window Controls */}
      <div className="titlebar-controls">
        {onCapture && (
          <button
            onClick={onCapture}
            className="titlebar-button"
            aria-label="New Capture"
            title="New Capture"
          >
            <Camera className="w-3.5 h-3.5" />
          </button>
        )}
        {onOpenLibrary && (
          <button
            onClick={onOpenLibrary}
            className="titlebar-button"
            aria-label="Open Library"
            title="Open Library"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </button>
        )}
        {onOpenSettings && (
          <button
            onClick={onOpenSettings}
            className="titlebar-button"
            aria-label="Settings"
            title="Settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={toggleTheme}
          className="titlebar-button"
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
          className="titlebar-button titlebar-button-minimize"
          aria-label="Minimize"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>
        {showMaximize && (
          <button
            onClick={handleMaximize}
            className="titlebar-button titlebar-button-maximize"
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
          className="titlebar-button titlebar-button-close"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
