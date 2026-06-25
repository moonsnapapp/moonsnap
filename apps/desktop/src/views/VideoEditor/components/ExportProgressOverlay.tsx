/**
 * ExportProgressOverlay - Modal overlay showing export progress.
 */
import { X } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import type { ExportProgress } from '../../../types';

export interface ExportProgressOverlayProps {
  isExporting: boolean;
  exportProgress: ExportProgress | null;
  onCancel: () => void;
}

const DEFAULT_EXPORT_PROGRESS_VIEW = {
  value: 0,
  percent: 0,
  stage: 'preparing',
  message: null,
};

function getKnownExportProgressView(progress: ExportProgress) {
  return {
    value: progress.progress,
    percent: Math.round(progress.progress * 100),
    stage: progress.stage,
    message: progress.message,
  };
}

function getExportProgressView(progress: ExportProgress | null) {
  return progress ? getKnownExportProgressView(progress) : DEFAULT_EXPORT_PROGRESS_VIEW;
}

function ExportProgressBar({ value }: { value: number }) {
  return (
    <div className="h-2 bg-[var(--polar-mist)] rounded-full overflow-hidden mb-2">
      <div
        className="h-full bg-[var(--accent-400)] transition-[width] duration-150 ease-out"
        style={{ width: `${value * 100}%` }}
      />
    </div>
  );
}

function ExportProgressInfo({ stage, percent }: { stage: string; percent: number }) {
  return (
    <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
      <span className="capitalize">{stage}</span>
      <span>{percent}%</span>
    </div>
  );
}

function ExportProgressMessage({ message }: { message: string | null }) {
  return message ? (
    <p className="text-xs text-[var(--ink-subtle)] mt-2 truncate">
      {message}
    </p>
  ) : null;
}

export function ExportProgressOverlay({ isExporting, exportProgress, onCancel }: ExportProgressOverlayProps) {
  if (!isExporting) return null;

  const progressView = getExportProgressView(exportProgress);

  return (
    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-[var(--polar-ice)] rounded-lg p-6 w-80 shadow-xl border border-[var(--glass-border)]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-[var(--ink-dark)]">Exporting Video</h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={onCancel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <ExportProgressBar value={progressView.value} />
        <ExportProgressInfo stage={progressView.stage} percent={progressView.percent} />
        <ExportProgressMessage message={progressView.message} />
      </div>
    </div>
  );
}
