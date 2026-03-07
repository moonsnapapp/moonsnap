import { useEffect, useState, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { toast } from 'sonner';
import { logger } from '@/utils/logger';
import type { UpdateChannel } from '@/types';

interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  contentLength: number;
  error: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface UpdateProgressToastProps {
  progress: number;
  contentLength: number;
}

function UpdateProgressToast({ progress, contentLength }: UpdateProgressToastProps) {
  const percent = contentLength > 0 ? Math.min((progress / contentLength) * 100, 100) : 0;

  return (
    <div className="w-[280px] rounded-lg p-4 bg-[var(--card)] border border-[var(--polar-frost)] shadow-lg">
      <div className="text-sm font-medium text-[var(--ink-dark)] mb-3">
        Downloading update...
      </div>
      <div className="h-2 bg-[var(--polar-mist)] rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-[var(--coral-400)] transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
        <span>{formatBytes(progress)} / {formatBytes(contentLength)}</span>
        <span>{Math.round(percent)}%</span>
      </div>
    </div>
  );
}

const BETA_MANIFEST_URL = 'https://github.com/moonsnapapp/moonsnap/releases/latest/download/latest-beta.json';

export function useUpdater(checkOnMount = true, channel: UpdateChannel = 'stable') {
  const [state, setState] = useState<UpdateState>({
    available: false,
    version: null,
    downloading: false,
    progress: 0,
    contentLength: 0,
    error: null,
  });
  const [update, setUpdate] = useState<Update | null>(null);

  const downloadAndInstallRef = useRef<((updateToInstall?: Update) => Promise<void>) | null>(null);

  const checkForUpdates = useCallback(async (showNoUpdateToast = false) => {
    try {
      setState(prev => ({ ...prev, error: null }));

      // Stable channel: use built-in Tauri updater (endpoints from tauri.conf.json)
      // Beta channel: also check beta manifest for newer beta versions
      const detected = await check();

      if (detected) {
        setUpdate(detected);
        setState(prev => ({
          ...prev,
          available: true,
          version: detected.version,
        }));

        toast.info(`Update available: v${detected.version}`, {
          action: {
            label: 'Install',
            onClick: () => downloadAndInstallRef.current?.(detected),
          },
          duration: 10000,
        });
      } else if (channel === 'beta') {
        // Check beta manifest for pre-release updates
        try {
          const res = await fetch(BETA_MANIFEST_URL);
          if (res.ok) {
            const manifest = await res.json();
            const currentVersion = await getVersion();
            if (manifest.version && manifest.version !== currentVersion) {
              setState(prev => ({
                ...prev,
                available: true,
                version: manifest.version,
              }));
              toast.info(`Beta update available: v${manifest.version}`, {
                action: {
                  label: 'Download',
                  onClick: () => {
                    window.open(`https://github.com/moonsnapapp/moonsnap/releases/tag/v${manifest.version}`, '_blank');
                  },
                },
                duration: 10000,
              });
            } else if (showNoUpdateToast) {
              toast.success('You are on the latest beta version');
            }
          }
        } catch {
          // Beta manifest not available yet, silently ignore
        }
      } else if (showNoUpdateToast) {
        toast.success('You are on the latest version');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates';
      setState(prev => ({ ...prev, error: message }));
      logger.error('Update check failed:', error);
    }
  }, [channel]);

  const downloadAndInstall = useCallback(async (updateToInstall?: Update) => {
    const target = updateToInstall || update;
    if (!target) return;

    const toastId = 'update-progress';
    let currentProgress = 0;
    let currentContentLength = 0;

    // Show initial progress toast
    toast.custom(
      () => <UpdateProgressToast progress={0} contentLength={0} />,
      { id: toastId, duration: Infinity }
    );

    setState(prev => ({ ...prev, downloading: true, progress: 0, contentLength: 0 }));

    try {
      await target.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          currentContentLength = event.data.contentLength;
          currentProgress = 0;
          setState(prev => ({ ...prev, progress: 0, contentLength: currentContentLength }));
          toast.custom(
            () => <UpdateProgressToast progress={0} contentLength={currentContentLength} />,
            { id: toastId, duration: Infinity }
          );
        } else if (event.event === 'Progress') {
          currentProgress += event.data.chunkLength;
          setState(prev => ({ ...prev, progress: currentProgress }));
          toast.custom(
            () => <UpdateProgressToast progress={currentProgress} contentLength={currentContentLength} />,
            { id: toastId, duration: Infinity }
          );
        } else if (event.event === 'Finished') {
          setState(prev => ({ ...prev, progress: currentContentLength }));
        }
      });

      toast.success('Update installed! Restarting...', { id: toastId });

      // Brief delay to show the success message
      await new Promise(resolve => setTimeout(resolve, 1500));
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install update';
      setState(prev => ({ ...prev, error: message, downloading: false }));
      toast.error(`Update failed: ${message}`, { id: toastId });
    }
  }, [update]);

  // Keep ref in sync with the latest downloadAndInstall function
  downloadAndInstallRef.current = downloadAndInstall;

  // Check for updates on mount (with delay to not slow down startup)
  useEffect(() => {
    if (checkOnMount) {
      const timer = setTimeout(() => {
        checkForUpdates(false);
      }, 5000); // Wait 5 seconds after app starts

      return () => clearTimeout(timer);
    }
  }, [checkOnMount, checkForUpdates]);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall: () => downloadAndInstall(),
  };
}
