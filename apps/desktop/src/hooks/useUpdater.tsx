import { useEffect } from 'react';
import { useUpdateStore } from '@/stores/updateStore';
import type { UpdateChannel } from '@/types';

export function useUpdater(checkOnMount = true, channel: UpdateChannel = 'stable') {
  const available = useUpdateStore((s) => s.available);
  const version = useUpdateStore((s) => s.version);
  const downloading = useUpdateStore((s) => s.downloading);
  const progress = useUpdateStore((s) => s.progress);
  const contentLength = useUpdateStore((s) => s.contentLength);
  const error = useUpdateStore((s) => s.error);
  const statusMessage = useUpdateStore((s) => s.statusMessage);
  const checkForUpdates = useUpdateStore((s) => s.checkForUpdates);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);

  useEffect(() => {
    if (!checkOnMount) {
      return undefined;
    }

    const timer = setTimeout(() => {
      void checkForUpdates(false, channel);
    }, 5000);

    return () => clearTimeout(timer);
  }, [channel, checkForUpdates, checkOnMount]);

  return {
    available,
    version,
    downloading,
    progress,
    contentLength,
    error,
    statusMessage,
    checkForUpdates: (showNoUpdateMessage = false) => checkForUpdates(showNoUpdateMessage, channel),
    downloadAndInstall: () => downloadAndInstall(),
  };
}
