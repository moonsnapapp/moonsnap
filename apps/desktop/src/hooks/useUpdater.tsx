import { useEffect, useState, useCallback, useRef } from 'react';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getVersion } from '@tauri-apps/api/app';
import { logger } from '@/utils/logger';
import type { UpdateChannel } from '@/types';

interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  contentLength: number;
  error: string | null;
  /** Inline status text — shown in the Settings dialog footer, not as a toast. */
  statusMessage: string | null;
}

const BETA_MANIFEST_URL = 'https://github.com/moonsnapapp/moonsnap/releases/latest/download/latest-beta.json';
const STATUS_MESSAGE_TIMEOUT_MS = 4000;

export function useUpdater(checkOnMount = true, channel: UpdateChannel = 'stable') {
  const [state, setState] = useState<UpdateState>({
    available: false,
    version: null,
    downloading: false,
    progress: 0,
    contentLength: 0,
    error: null,
    statusMessage: null,
  });
  const [update, setUpdate] = useState<Update | null>(null);

  const downloadAndInstallRef = useRef<((updateToInstall?: Update) => Promise<void>) | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTransientStatus = useCallback((message: string | null) => {
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current);
      statusTimerRef.current = null;
    }
    setState(prev => ({ ...prev, statusMessage: message }));
    if (message) {
      statusTimerRef.current = setTimeout(() => {
        setState(prev => ({ ...prev, statusMessage: null }));
        statusTimerRef.current = null;
      }, STATUS_MESSAGE_TIMEOUT_MS);
    }
  }, []);

  const checkForUpdates = useCallback(async (showNoUpdateMessage = false) => {
    try {
      setState(prev => ({ ...prev, error: null, statusMessage: null }));

      // Stable channel: use built-in Tauri updater (endpoints from tauri.conf.json)
      // Beta channel: also check beta manifest for newer beta versions
      const detected = await check();

      if (detected) {
        setUpdate(detected);
        setState(prev => ({
          ...prev,
          available: true,
          version: detected.version,
          statusMessage: `Update available: v${detected.version}`,
        }));
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
                statusMessage: `Beta update available: v${manifest.version}`,
              }));
            } else if (showNoUpdateMessage) {
              setTransientStatus('You are on the latest beta version');
            }
          }
        } catch {
          // Beta manifest not available yet, silently ignore
        }
      } else if (showNoUpdateMessage) {
        setTransientStatus('You are on the latest version');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to check for updates';
      setState(prev => ({ ...prev, error: message, statusMessage: `Update check failed: ${message}` }));
      logger.error('Update check failed:', error);
    }
  }, [channel, setTransientStatus]);

  const downloadAndInstall = useCallback(async (updateToInstall?: Update) => {
    const target = updateToInstall || update;
    if (!target) return;

    let currentProgress = 0;
    let currentContentLength = 0;

    // All progress/status is surfaced in the Settings dialog footer; toasts
    // would just sit blurred behind the dialog overlay.
    setState(prev => ({
      ...prev,
      downloading: true,
      progress: 0,
      contentLength: 0,
      statusMessage: 'Downloading update…',
    }));

    try {
      await target.downloadAndInstall((event) => {
        if (event.event === 'Started' && event.data.contentLength) {
          currentContentLength = event.data.contentLength;
          currentProgress = 0;
          setState(prev => ({ ...prev, progress: 0, contentLength: currentContentLength }));
        } else if (event.event === 'Progress') {
          currentProgress += event.data.chunkLength;
          setState(prev => ({ ...prev, progress: currentProgress }));
        } else if (event.event === 'Finished') {
          setState(prev => ({ ...prev, progress: currentContentLength }));
        }
      });

      setState(prev => ({ ...prev, statusMessage: 'Update installed — restarting…' }));

      // Brief delay so the user sees the success message before relaunch.
      await new Promise(resolve => setTimeout(resolve, 1500));
      await relaunch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to install update';
      setState(prev => ({
        ...prev,
        error: message,
        downloading: false,
        statusMessage: `Update failed: ${message}`,
      }));
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

  // Clear any pending transient-status timer on unmount.
  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  return {
    ...state,
    checkForUpdates,
    downloadAndInstall: () => downloadAndInstall(),
  };
}
