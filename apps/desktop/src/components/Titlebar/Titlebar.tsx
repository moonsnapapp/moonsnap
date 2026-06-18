import { useState, useEffect } from 'react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { Minus, Square, X, Maximize2, Aperture, Sun, Moon, FolderOpen, Camera, Settings } from 'lucide-react';
import { useFocusedShortcutDispatch } from '@/hooks/useFocusedShortcutDispatch';
import { useTheme } from '@/hooks/useTheme';
import { UpdateAvailablePill } from '@/components/Updates/UpdateAvailablePill';

interface TitlebarBaseProps {
  title?: string;
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

interface DefaultTitlebarProps extends TitlebarBaseProps {
  showLogo?: boolean;
}

interface HudTitlebarProps extends TitlebarBaseProps {
  /** Short context label shown on the left in HUD mode. */
  contextLabel?: string;
  /** Secondary detail shown next to the context chip in HUD mode. */
  detailLabel?: string;
  /** Optional interactive control shown in place of the context chip. */
  leftControl?: React.ReactNode;
}

interface TitlebarFrameProps {
  showMaximize: boolean;
  isHud: boolean;
  left: React.ReactNode;
  center?: React.ReactNode;
  onClose?: () => void | boolean | Promise<void | boolean>;
  onOpenLibrary?: () => void;
  onCapture?: () => void;
  onOpenSettings?: () => void;
}

interface TitlebarControlsProps {
  showMaximize: boolean;
  isHud: boolean;
  isMaximized: boolean;
  buttonClassName: string;
  resolvedTheme: 'light' | 'dark';
  onCapture?: () => void;
  onOpenLibrary?: () => void;
  onOpenSettings?: () => void;
  onToggleTheme: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
}

type AppWindow = ReturnType<typeof getCurrentWebviewWindow>;

function getTitlebarButtonClassName(isHud: boolean) {
  return `titlebar-button${isHud ? ' titlebar-button--hud' : ''}`;
}

function getTitlebarClassName(isHud: boolean, isDragging: boolean) {
  return `titlebar ${isHud ? 'titlebar--hud' : ''} ${isDragging ? 'titlebar-dragging' : ''}`;
}

function getTitlebarLeftClassName(isHud: boolean) {
  return `titlebar-left ${isHud ? 'titlebar-left--hud' : ''}`;
}

async function canCloseTitlebar(onClose: TitlebarFrameProps['onClose']) {
  return onClose ? (await onClose()) !== false : true;
}

async function closeTitlebarWindow(appWindow: AppWindow, onClose: TitlebarFrameProps['onClose']) {
  if (await canCloseTitlebar(onClose)) {
    await appWindow.close();
  }
}

function DefaultTitlebarLeft({ title, showLogo }: { title: string; showLogo: boolean }) {
  return (
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
  );
}

function HudTitlebarLeft({
  contextLabel,
  detailLabel,
  leftControl,
}: {
  contextLabel?: string;
  detailLabel?: string;
  leftControl?: React.ReactNode;
}) {
  return (
    <>
      {leftControl ?? (
        <span className="titlebar-hud-context" data-tauri-drag-region>
          {contextLabel ?? 'Workspace'}
        </span>
      )}
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
  );
}

function HudTitlebarCenter({ title }: { title: string }) {
  return (
    <div className="titlebar-hud-brand" data-tauri-drag-region>
      <span className="titlebar-hud-brand-wordmark" data-tauri-drag-region>
        {title}
      </span>
    </div>
  );
}

function useWindowMaximized(appWindow: ReturnType<typeof getCurrentWebviewWindow>) {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized);

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

  return isMaximized;
}

function TitlebarIconButton({
  className,
  label,
  title,
  onClick,
  children,
}: {
  className: string;
  label: string;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={className}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}

function TitlebarAppActionButtons({
  buttonClassName,
  onCapture,
  onOpenLibrary,
  onOpenSettings,
}: Pick<TitlebarControlsProps, 'buttonClassName' | 'onCapture' | 'onOpenLibrary' | 'onOpenSettings'>) {
  return (
    <>
      {onCapture && (
        <TitlebarIconButton
          className={buttonClassName}
          label="New Capture"
          title="New Capture"
          onClick={onCapture}
        >
          <Camera className="w-3.5 h-3.5" />
        </TitlebarIconButton>
      )}
      {onOpenLibrary && (
        <TitlebarIconButton
          className={buttonClassName}
          label="Open Library"
          title="Open Library"
          onClick={onOpenLibrary}
        >
          <FolderOpen className="w-3.5 h-3.5" />
        </TitlebarIconButton>
      )}
      {onOpenSettings && (
        <TitlebarIconButton
          className={buttonClassName}
          label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="w-3.5 h-3.5" />
        </TitlebarIconButton>
      )}
    </>
  );
}

function TitlebarThemeButton({
  buttonClassName,
  resolvedTheme,
  onToggleTheme,
}: Pick<TitlebarControlsProps, 'buttonClassName' | 'resolvedTheme' | 'onToggleTheme'>) {
  const themeLabel = resolvedTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';

  return (
    <TitlebarIconButton
      className={buttonClassName}
      label={themeLabel}
      title={themeLabel}
      onClick={onToggleTheme}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className="w-3.5 h-3.5" />
      ) : (
        <Moon className="w-3.5 h-3.5" />
      )}
    </TitlebarIconButton>
  );
}

function TitlebarWindowButtons({
  showMaximize,
  isMaximized,
  buttonClassName,
  onMinimize,
  onMaximize,
  onClose,
}: Pick<TitlebarControlsProps, 'showMaximize' | 'isMaximized' | 'buttonClassName' | 'onMinimize' | 'onMaximize' | 'onClose'>) {
  return (
    <>
      <TitlebarIconButton
        className={`${buttonClassName} titlebar-button-minimize`}
        label="Minimize"
        onClick={onMinimize}
      >
        <Minus className="w-3.5 h-3.5" />
      </TitlebarIconButton>
      {showMaximize && (
        <TitlebarIconButton
          className={`${buttonClassName} titlebar-button-maximize`}
          label={isMaximized ? 'Restore' : 'Maximize'}
          onClick={onMaximize}
        >
          {isMaximized ? (
            <Maximize2 className="w-3 h-3" />
          ) : (
            <Square className="w-3 h-3" />
          )}
        </TitlebarIconButton>
      )}
      <TitlebarIconButton
        className={`${buttonClassName} titlebar-button-close`}
        label="Close"
        onClick={onClose}
      >
        <X className="w-4 h-4" />
      </TitlebarIconButton>
    </>
  );
}

function TitlebarControls({
  showMaximize,
  isHud,
  isMaximized,
  buttonClassName,
  resolvedTheme,
  onCapture,
  onOpenLibrary,
  onOpenSettings,
  onToggleTheme,
  onMinimize,
  onMaximize,
  onClose,
}: TitlebarControlsProps) {
  return (
    <div className={`titlebar-controls ${isHud ? 'titlebar-controls--hud' : ''}`}>
      {isHud && <UpdateAvailablePill variant="titlebar" />}
      <TitlebarAppActionButtons
        buttonClassName={buttonClassName}
        onCapture={onCapture}
        onOpenLibrary={onOpenLibrary}
        onOpenSettings={onOpenSettings}
      />
      <TitlebarThemeButton
        buttonClassName={buttonClassName}
        resolvedTheme={resolvedTheme}
        onToggleTheme={onToggleTheme}
      />
      <TitlebarWindowButtons
        showMaximize={showMaximize}
        isMaximized={isMaximized}
        buttonClassName={buttonClassName}
        onMinimize={onMinimize}
        onMaximize={onMaximize}
        onClose={onClose}
      />
    </div>
  );
}

function TitlebarFrame({
  showMaximize,
  isHud,
  left,
  center,
  onClose,
  onOpenLibrary,
  onCapture,
  onOpenSettings,
}: TitlebarFrameProps) {
  const [isDragging, setIsDragging] = useState(false);
  const appWindow = getCurrentWebviewWindow();
  const isMaximized = useWindowMaximized(appWindow);
  const { resolvedTheme, toggleTheme } = useTheme();
  useFocusedShortcutDispatch();

  const buttonClassName = getTitlebarButtonClassName(isHud);

  // Handle drag state
  const handleMouseDown = () => setIsDragging(true);
  const handleMouseUp = () => setIsDragging(false);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = () => appWindow.toggleMaximize();
  const handleClose = () => {
    void closeTitlebarWindow(appWindow, onClose);
  };

  return (
    <div
      data-tauri-drag-region
      className={getTitlebarClassName(isHud, isDragging)}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Left: Logo & Title */}
      <div
        className={getTitlebarLeftClassName(isHud)}
        data-tauri-drag-region
      >
        {left}
      </div>

      {/* Center: Drag Region / HUD Brand */}
      <div className="titlebar-center" data-tauri-drag-region>
        {center}
      </div>

      <TitlebarControls
        showMaximize={showMaximize}
        isHud={isHud}
        isMaximized={isMaximized}
        buttonClassName={buttonClassName}
        resolvedTheme={resolvedTheme}
        onCapture={onCapture}
        onOpenLibrary={onOpenLibrary}
        onOpenSettings={onOpenSettings}
        onToggleTheme={toggleTheme}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
      />
    </div>
  );
}

export function DefaultTitlebar({
  title = 'MoonSnap',
  showLogo = true,
  showMaximize = true,
  onClose,
  onOpenLibrary,
  onCapture,
  onOpenSettings,
}: DefaultTitlebarProps) {
  return (
    <TitlebarFrame
      showMaximize={showMaximize}
      isHud={false}
      left={<DefaultTitlebarLeft title={title} showLogo={showLogo} />}
      onClose={onClose}
      onOpenLibrary={onOpenLibrary}
      onCapture={onCapture}
      onOpenSettings={onOpenSettings}
    />
  );
}

export function HudTitlebar({
  title = 'MoonSnap',
  showMaximize = true,
  contextLabel,
  detailLabel,
  leftControl,
  onClose,
  onOpenLibrary,
  onCapture,
  onOpenSettings,
}: HudTitlebarProps) {
  return (
    <TitlebarFrame
      showMaximize={showMaximize}
      isHud={true}
      left={
        <HudTitlebarLeft
          contextLabel={contextLabel}
          detailLabel={detailLabel}
          leftControl={leftControl}
        />
      }
      center={<HudTitlebarCenter title={title} />}
      onClose={onClose}
      onOpenLibrary={onOpenLibrary}
      onCapture={onCapture}
      onOpenSettings={onOpenSettings}
    />
  );
}
