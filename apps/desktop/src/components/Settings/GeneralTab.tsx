import React, { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen, ExternalLink, Sun, Moon, Monitor, FileText, RotateCcw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTheme } from '@/hooks/useTheme';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Theme, UpdateChannel } from '@/types';
import { settingsLogger } from '@/utils/logger';

/** Dialog stages for the move flow */
type MoveStage = 'ask-move' | 'locked' | 'confirm' | 'moving' | 'done';

interface MoveProgress {
  moved: number;
  total: number;
  name: string;
}

interface DirCheckResult {
  item_count: number;
  locked_files: string[];
}

export const GeneralTab: React.FC = () => {
  const { settings, updateGeneralSettings } = useSettingsStore();
  const { general } = settings;
  const { setTheme } = useTheme();

  const [isAutostartEnabled, setIsAutostartEnabled] = useState(false);
  const [isLoadingAutostart, setIsLoadingAutostart] = useState(true);

  // Move dialog state
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveStage, setMoveStage] = useState<MoveStage>('ask-move');
  const [moveSource, setMoveSource] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [moveItemCount, setMoveItemCount] = useState(0);
  const [moveProgress, setMoveProgress] = useState<MoveProgress>({ moved: 0, total: 0, name: '' });
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lockedFiles, setLockedFiles] = useState<string[]>([]);
  const [isChecking, setIsChecking] = useState(false);

  // Load autostart status on mount
  useEffect(() => {
    const loadAutostartStatus = async () => {
      try {
        const enabled = await invoke<boolean>('is_autostart_enabled');
        setIsAutostartEnabled(enabled);
      } catch (error) {
        settingsLogger.error('Failed to get autostart status:', error);
      } finally {
        setIsLoadingAutostart(false);
      }
    };
    loadAutostartStatus();
  }, []);

  // Set default save directory if not configured (runs once on mount)
  useEffect(() => {
    const initDefaultSaveDir = async () => {
      if (!general.defaultSaveDir) {
        try {
          const defaultDir = await invoke<string>('get_default_save_dir');
          updateGeneralSettings({ defaultSaveDir: defaultDir });
        } catch (error) {
          settingsLogger.error('Failed to set default save dir:', error);
        }
      }
    };
    initDefaultSaveDir();
  }, []);

  const handleAutostartChange = async (enabled: boolean) => {
    try {
      await invoke('set_autostart', { enabled });
      setIsAutostartEnabled(enabled);
      updateGeneralSettings({ startWithWindows: enabled });
    } catch (error) {
      settingsLogger.error('Failed to set autostart:', error);
    }
  };

  /** Run the locked-file check and transition to 'locked' or 'confirm' stage */
  const runMoveCheck = useCallback(async (sourcePath: string) => {
    setIsChecking(true);
    try {
      const result = await invoke<DirCheckResult>('check_dir_for_move', { path: sourcePath });
      setMoveItemCount(result.item_count);
      setLockedFiles(result.locked_files);
      setMoveStage(result.locked_files.length > 0 ? 'locked' : 'confirm');
    } catch (error) {
      settingsLogger.error('Failed to check directory:', error);
    } finally {
      setIsChecking(false);
    }
  }, []);

  /** If the picked folder is already called "MoonSnap" use it as-is,
   *  otherwise append a MoonSnap subfolder so captures stay organised. */
  const ensureMoonSnapFolder = (dir: string): string => {
    const trimmed = dir.replace(/[\\/]+$/, '');
    const basename = trimmed.split(/[\\/]/).pop() ?? '';
    return basename === 'MoonSnap' ? trimmed : `${trimmed}\\MoonSnap`;
  };

  /** Open folder picker, then show ask-move dialog if there are existing files. */
  const handleBrowseSaveDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Select Default Save Location',
      });
      if (!selected || typeof selected !== 'string') return;

      const saveDir = ensureMoonSnapFolder(selected);

      if (saveDir === general.defaultSaveDir) return;

      const currentDir = general.defaultSaveDir;
      if (!currentDir) {
        // No previous dir — just set it
        updateGeneralSettings({ defaultSaveDir: saveDir });
        return;
      }

      // Check if old dir has any files worth moving
      const result = await invoke<DirCheckResult>('check_dir_for_move', { path: currentDir });
      if (result.item_count === 0) {
        // Nothing to move — just change the setting
        updateGeneralSettings({ defaultSaveDir: saveDir });
        return;
      }

      // Has files — ask the user
      setMoveSource(currentDir);
      setMoveTarget(saveDir);
      setMoveItemCount(result.item_count);
      setMoveError(null);
      setMoveProgress({ moved: 0, total: 0, name: '' });
      setLockedFiles([]);
      setMoveStage('ask-move');
      setMoveDialogOpen(true);
    } catch (error) {
      settingsLogger.error('Failed to open directory picker:', error);
    }
  };

  const handleResetSaveDir = async () => {
    try {
      const defaultDir = await invoke<string>('get_default_save_dir');
      if (defaultDir === general.defaultSaveDir) return;

      const currentDir = general.defaultSaveDir;
      if (!currentDir) {
        updateGeneralSettings({ defaultSaveDir: defaultDir });
        return;
      }

      // Check if old dir has files
      const result = await invoke<DirCheckResult>('check_dir_for_move', { path: currentDir });
      if (result.item_count === 0) {
        updateGeneralSettings({ defaultSaveDir: defaultDir });
        return;
      }

      // Has files — ask the user
      setMoveSource(currentDir);
      setMoveTarget(defaultDir);
      setMoveItemCount(result.item_count);
      setMoveError(null);
      setMoveProgress({ moved: 0, total: 0, name: '' });
      setLockedFiles([]);
      setMoveStage('ask-move');
      setMoveDialogOpen(true);
    } catch (error) {
      settingsLogger.error('Failed to reset save dir:', error);
    }
  };

  /** User chose "Yes, move files" from ask-move stage */
  const handleAcceptMove = useCallback(() => {
    runMoveCheck(moveSource);
  }, [moveSource, runMoveCheck]);

  /** User chose "No, just change location" from ask-move stage */
  const handleSkipMove = useCallback(() => {
    updateGeneralSettings({ defaultSaveDir: moveTarget });
    setMoveDialogOpen(false);
  }, [moveTarget, updateGeneralSettings]);

  /** Retry the locked-file check */
  const handleRetryMoveCheck = useCallback(() => {
    runMoveCheck(moveSource);
  }, [moveSource, runMoveCheck]);

  /** Execute the move */
  const handleMoveConfirm = useCallback(async () => {
    if (!moveSource || !moveTarget) return;

    setMoveStage('moving');
    setMoveError(null);

    const unlisten = await listen<MoveProgress>('move-save-dir-progress', (event) => {
      setMoveProgress(event.payload);
    });

    try {
      await invoke('move_save_dir', { oldPath: moveSource, newPath: moveTarget });
      updateGeneralSettings({ defaultSaveDir: moveTarget });
      setMoveStage('done');
      setTimeout(() => {
        setMoveDialogOpen(false);
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setMoveError(message);
      settingsLogger.error('Failed to move save dir:', error);
    } finally {
      unlisten();
    }
  }, [moveSource, moveTarget, updateGeneralSettings]);

  const handleOpenSaveDir = async () => {
    if (general.defaultSaveDir) {
      try {
        await invoke('open_path_in_explorer', { path: general.defaultSaveDir });
      } catch (error) {
        settingsLogger.error('Failed to open directory:', error);
      }
    }
  };

  const handleThemeChange = (theme: Theme) => {
    setTheme(theme);
  };

  const moveProgressPercent = moveProgress.total > 0
    ? Math.round((moveProgress.moved / moveProgress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {/* Appearance Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Appearance
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]">
          <div>
            <label className="text-sm text-[var(--ink-black)] mb-3 block">
              Theme
            </label>
            <div className="flex gap-1.5">
              <button
                onClick={() => handleThemeChange('light')}
                className={`editor-choice-pill flex-1 flex items-center justify-center gap-2 px-2 py-2 text-xs ${
                  general.theme === 'light' ? 'editor-choice-pill--active' : ''
                }`}
              >
                <Sun className="w-4 h-4" />
                Light
              </button>
              <button
                onClick={() => handleThemeChange('dark')}
                className={`editor-choice-pill flex-1 flex items-center justify-center gap-2 px-2 py-2 text-xs ${
                  general.theme === 'dark' ? 'editor-choice-pill--active' : ''
                }`}
              >
                <Moon className="w-4 h-4" />
                Dark
              </button>
              <button
                onClick={() => handleThemeChange('system')}
                className={`editor-choice-pill flex-1 flex items-center justify-center gap-2 px-2 py-2 text-xs ${
                  general.theme === 'system' ? 'editor-choice-pill--active' : ''
                }`}
              >
                <Monitor className="w-4 h-4" />
                System
              </button>
            </div>
            <p className="text-xs text-[var(--ink-muted)] mt-2">
              System follows your operating system&apos;s dark mode setting
            </p>
          </div>
        </div>
      </section>

      {/* Startup Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Startup
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm text-[var(--ink-black)]">
                Launch when Windows starts
              </p>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                MoonSnap will start minimized in the system tray
              </p>
            </div>
            <Switch
              checked={isAutostartEnabled}
              onCheckedChange={handleAutostartChange}
              className={isLoadingAutostart ? 'opacity-50' : ''}
            />
          </label>

          <label className="flex items-center justify-between cursor-pointer">
            <div>
              <p className="text-sm text-[var(--ink-black)]">
                Close to system tray
              </p>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                Minimize to tray instead of quitting when closing the window
              </p>
            </div>
            <Switch
              checked={general.minimizeToTray}
              onCheckedChange={(checked) => {
                updateGeneralSettings({ minimizeToTray: checked });
                invoke('set_close_to_tray', { enabled: checked });
              }}
            />
          </label>
        </div>
      </section>

      {/* Save Options Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Save Options
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
          {/* Default Save Location */}
          <div>
            <label className="text-sm text-[var(--ink-black)] mb-2 block">
              Default save location
            </label>
            <div className="flex gap-2">
              <Input
                value={general.defaultSaveDir || ''}
                placeholder="Click Browse to select..."
                readOnly
                className="flex-1 text-sm bg-[var(--card)]"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleBrowseSaveDir}
                className="shrink-0 bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
              >
                <FolderOpen className="w-4 h-4 mr-1" />
                Browse
              </Button>
              {general.defaultSaveDir && (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleOpenSaveDir}
                    title="Open in Explorer"
                    className="shrink-0 text-[var(--ink-muted)] hover:text-[var(--ink-black)] hover:bg-[var(--polar-mist)]"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleResetSaveDir}
                    title="Reset to default location"
                    className="shrink-0 text-[var(--ink-muted)] hover:text-[var(--ink-black)] hover:bg-[var(--polar-mist)]"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </Button>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Move / Change Location Dialog */}
      <Dialog
        open={moveDialogOpen}
        onOpenChange={(open) => {
          if (!open && moveStage !== 'moving') {
            setMoveDialogOpen(false);
          }
        }}
      >
        <DialogContent hideCloseButton={moveStage === 'moving'}>
          {/* Stage 1: Ask whether to move existing files */}
          {moveStage === 'ask-move' && (
            <>
              <DialogHeader>
                <DialogTitle>Move Existing Files?</DialogTitle>
                <DialogDescription>
                  Your current save folder has {moveItemCount} {moveItemCount === 1 ? 'item' : 'items'}.
                  Would you like to move them to the new location?
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-[var(--ink-muted)]">From:</span>
                  <p className="font-mono text-xs text-[var(--ink-dark)] bg-[var(--polar-mist)] rounded px-2 py-1 mt-0.5 break-all">
                    {moveSource}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--ink-muted)]">To:</span>
                  <p className="font-mono text-xs text-[var(--ink-dark)] bg-[var(--polar-mist)] rounded px-2 py-1 mt-0.5 break-all">
                    {moveTarget}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={handleSkipMove}
                  className="bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
                >
                  No, Just Change Location
                </Button>
                <Button
                  onClick={handleAcceptMove}
                  disabled={isChecking}
                  className="bg-[var(--coral-400)] text-white hover:bg-[var(--coral-500)]"
                >
                  {isChecking ? 'Checking...' : 'Yes, Move Files'}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Stage 2 (conditional): Locked files warning */}
          {moveStage === 'locked' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                  Files In Use
                </DialogTitle>
                <DialogDescription>
                  Some files are currently in use and cannot be moved. Close any applications using these files, then retry.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-40 overflow-y-auto rounded bg-[var(--polar-mist)] p-2">
                {lockedFiles.map((file) => (
                  <p key={file} className="font-mono text-xs text-[var(--ink-dark)] py-0.5 truncate">
                    {file}
                  </p>
                ))}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setMoveDialogOpen(false)}
                  className="bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleRetryMoveCheck}
                  disabled={isChecking}
                  className="bg-[var(--coral-400)] text-white hover:bg-[var(--coral-500)]"
                >
                  {isChecking ? 'Checking...' : 'Retry'}
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Stage 3: Confirm move */}
          {moveStage === 'confirm' && (
            <>
              <DialogHeader>
                <DialogTitle>Move Save Folder</DialogTitle>
                <DialogDescription>
                  Move {moveItemCount} {moveItemCount === 1 ? 'item' : 'items'} to the new location.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 text-sm">
                <div>
                  <span className="text-[var(--ink-muted)]">From:</span>
                  <p className="font-mono text-xs text-[var(--ink-dark)] bg-[var(--polar-mist)] rounded px-2 py-1 mt-0.5 break-all">
                    {moveSource}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--ink-muted)]">To:</span>
                  <p className="font-mono text-xs text-[var(--ink-dark)] bg-[var(--polar-mist)] rounded px-2 py-1 mt-0.5 break-all">
                    {moveTarget}
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setMoveDialogOpen(false)}
                  className="bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleMoveConfirm}
                  className="bg-[var(--coral-400)] text-white hover:bg-[var(--coral-500)]"
                >
                  Move Files
                </Button>
              </DialogFooter>
            </>
          )}

          {/* Stage 4: Moving in progress */}
          {moveStage === 'moving' && (
            <>
              <DialogHeader>
                <DialogTitle>Moving Files...</DialogTitle>
                <DialogDescription>
                  Please wait while your files are being moved.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="h-2 bg-[var(--polar-mist)] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--coral-400)] transition-all duration-300"
                    style={{ width: `${moveProgressPercent}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
                  <span className="truncate max-w-[200px]">{moveProgress.name || 'Preparing...'}</span>
                  <span>{moveProgress.moved} / {moveProgress.total}</span>
                </div>
                {moveError && (
                  <p className="text-xs text-red-500 mt-2">{moveError}</p>
                )}
              </div>
            </>
          )}

          {/* Stage 5: Done */}
          {moveStage === 'done' && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                  Move Complete
                </DialogTitle>
                <DialogDescription>
                  All files have been moved to the new location.
                </DialogDescription>
              </DialogHeader>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Updates Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Updates
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]">
          <div>
            <label className="text-sm text-[var(--ink-black)] mb-3 block">
              Update channel
            </label>
            <div className="flex gap-1.5">
              {(['stable', 'beta'] as const).map((ch: UpdateChannel) => (
                <button
                  key={ch}
                  onClick={() => updateGeneralSettings({ updateChannel: ch })}
                  className={`editor-choice-pill flex-1 px-2 py-2 text-xs capitalize ${
                    general.updateChannel === ch ? 'editor-choice-pill--active' : ''
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>
            <p className="text-xs text-[var(--ink-muted)] mt-2">
              Beta channel receives early updates that may be less stable
            </p>
          </div>
        </div>
      </section>

      {/* Advanced Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          Advanced
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-[var(--ink-black)]">
                Application logs
              </p>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                View logs for troubleshooting (Ctrl+Shift+L)
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => invoke('open_log_dir')}
              className="bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
            >
              <FileText className="w-4 h-4 mr-1" />
              View Logs
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
