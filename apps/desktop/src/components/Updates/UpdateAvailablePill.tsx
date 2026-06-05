import React from 'react';
import { Download, Loader2, Sparkles } from 'lucide-react';
import { useUpdateStore } from '@/stores/updateStore';

interface UpdateAvailablePillProps {
  variant?: 'titlebar' | 'toolbar';
}

export const UpdateAvailablePill: React.FC<UpdateAvailablePillProps> = ({
  variant = 'titlebar',
}) => {
  const available = useUpdateStore((s) => s.available);
  const version = useUpdateStore((s) => s.version);
  const downloading = useUpdateStore((s) => s.downloading);
  const progress = useUpdateStore((s) => s.progress);
  const contentLength = useUpdateStore((s) => s.contentLength);
  const downloadAndInstall = useUpdateStore((s) => s.downloadAndInstall);

  if (!available || !version) {
    return null;
  }

  const downloadPercent = contentLength > 0
    ? Math.min(Math.round((progress / contentLength) * 100), 100)
    : 0;
  const label = downloading ? `Installing ${downloadPercent}%` : `Update v${version}`;
  const compactLabel = downloading ? `${downloadPercent}%` : version;

  return (
    <button
      type="button"
      className={`update-pill update-pill--${variant}`}
      onClick={() => void downloadAndInstall()}
      disabled={downloading}
      aria-label={downloading ? `Installing update ${downloadPercent}%` : `Install MoonSnap version ${version}`}
      title={downloading ? `Installing update ${downloadPercent}%` : `Install MoonSnap v${version}`}
    >
      {downloading ? (
        <Loader2 className="update-pill__icon update-pill__icon--spin" aria-hidden="true" />
      ) : variant === 'toolbar' ? (
        <Download className="update-pill__icon" aria-hidden="true" />
      ) : (
        <Sparkles className="update-pill__icon" aria-hidden="true" />
      )}
      <span className="update-pill__label">
        {variant === 'toolbar' ? compactLabel : label}
      </span>
    </button>
  );
};
