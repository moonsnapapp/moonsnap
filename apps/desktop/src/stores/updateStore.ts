import { getVersion } from '@tauri-apps/api/app';
import { relaunch } from '@tauri-apps/plugin-process';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { logger } from '@/utils/logger';
import type { UpdateChannel } from '@/types';

interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number;
  contentLength: number;
  error: string | null;
  statusMessage: string | null;
  update: Update | null;
  checkForUpdates: (showNoUpdateMessage?: boolean, channel?: UpdateChannel) => Promise<void>;
  downloadAndInstall: (updateToInstall?: Update) => Promise<void>;
}

const BETA_MANIFEST_URL = 'https://github.com/moonsnapapp/moonsnap/releases/latest/download/latest-beta.json';
const STATUS_MESSAGE_TIMEOUT_MS = 4000;
const RELAUNCH_DELAY_MS = 1500;

let statusTimer: ReturnType<typeof setTimeout> | null = null;
let checkInFlight: Promise<void> | null = null;

function clearStatusTimer() {
  if (statusTimer) {
    clearTimeout(statusTimer);
    statusTimer = null;
  }
}

function setTransientStatus(setState: (partial: Partial<UpdateState>) => void, message: string | null) {
  clearStatusTimer();
  setState({ statusMessage: message });

  if (!message) {
    return;
  }

  statusTimer = setTimeout(() => {
    setState({ statusMessage: null });
    statusTimer = null;
  }, STATUS_MESSAGE_TIMEOUT_MS);
}

export const useUpdateStore = create<UpdateState>()(
  devtools(
    (set, get) => ({
      available: false,
      version: null,
      downloading: false,
      progress: 0,
      contentLength: 0,
      error: null,
      statusMessage: null,
      update: null,

      checkForUpdates: async (showNoUpdateMessage = false, channel = 'stable') => {
        if (checkInFlight) {
          await checkInFlight;
          return;
        }

        checkInFlight = (async () => {
          try {
            set({ error: null, statusMessage: null }, false, 'update/checkForUpdates:start');

            const detected = await check();

            if (detected) {
              set(
                {
                  available: true,
                  version: detected.version,
                  update: detected,
                  statusMessage: `Update available: v${detected.version}`,
                },
                false,
                'update/checkForUpdates:available'
              );
              return;
            }

            if (channel === 'beta') {
              try {
                const res = await fetch(BETA_MANIFEST_URL);
                if (res.ok) {
                  const manifest = await res.json();
                  const currentVersion = await getVersion();
                  if (manifest.version && manifest.version !== currentVersion) {
                    set(
                      {
                        available: true,
                        version: manifest.version,
                        update: null,
                        statusMessage: `Beta update available: v${manifest.version}`,
                      },
                      false,
                      'update/checkForUpdates:betaAvailable'
                    );
                  } else if (showNoUpdateMessage) {
                    setTransientStatus(set, 'You are on the latest beta version');
                  }
                }
              } catch {
                // Beta manifest may not exist for every release train.
              }
              return;
            }

            set(
              {
                available: false,
                version: null,
                update: null,
              },
              false,
              'update/checkForUpdates:none'
            );

            if (showNoUpdateMessage) {
              setTransientStatus(set, 'You are on the latest version');
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to check for updates';
            set(
              {
                error: message,
                statusMessage: `Update check failed: ${message}`,
              },
              false,
              'update/checkForUpdates:error'
            );
            logger.error('Update check failed:', error);
          } finally {
            checkInFlight = null;
          }
        })();

        await checkInFlight;
      },

      downloadAndInstall: async (updateToInstall?: Update) => {
        const target = updateToInstall || get().update;
        if (!target || get().downloading) {
          return;
        }

        let currentProgress = 0;
        let currentContentLength = 0;

        set(
          {
            downloading: true,
            progress: 0,
            contentLength: 0,
            error: null,
            statusMessage: 'Downloading update...',
          },
          false,
          'update/downloadAndInstall:start'
        );

        try {
          await target.downloadAndInstall((event) => {
            if (event.event === 'Started' && event.data.contentLength) {
              currentContentLength = event.data.contentLength;
              currentProgress = 0;
              set({ progress: 0, contentLength: currentContentLength }, false, 'update/downloadAndInstall:started');
            } else if (event.event === 'Progress') {
              currentProgress += event.data.chunkLength;
              set({ progress: currentProgress }, false, 'update/downloadAndInstall:progress');
            } else if (event.event === 'Finished') {
              set({ progress: currentContentLength }, false, 'update/downloadAndInstall:finished');
            }
          });

          set({ statusMessage: 'Update installed - restarting...' }, false, 'update/downloadAndInstall:installed');

          await new Promise(resolve => setTimeout(resolve, RELAUNCH_DELAY_MS));
          await relaunch();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to install update';
          set(
            {
              error: message,
              downloading: false,
              statusMessage: `Update failed: ${message}`,
            },
            false,
            'update/downloadAndInstall:error'
          );
        }
      },
    }),
    { name: 'UpdateStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
