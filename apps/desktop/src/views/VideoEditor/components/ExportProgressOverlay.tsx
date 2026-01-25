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

export function ExportProgressOverlay({ isExporting, exportProgress, onCancel }: ExportProgressOverlayProps) {
  if (!isExporting) return null;

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

        {/* Progress bar */}
        <div className="h-2 bg-[var(--polar-mist)] rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-[var(--coral-400)] transition-all duration-300"
            style={{ width: `${(exportProgress?.progress ?? 0) * 100}%` }}
          />
        </div>

        {/* Progress info */}
        <div className="flex items-center justify-between text-xs text-[var(--ink-muted)]">
          <span className="capitalize">{exportProgress?.stage ?? 'preparing'}</span>
          <span>{Math.round((exportProgress?.progress ?? 0) * 100)}%</span>
        </div>

        {/* Status message */}
        {exportProgress?.message && (
          <p className="text-xs text-[var(--ink-subtle)] mt-2 truncate">
            {exportProgress.message}
          </p>
        )}
      </div>
    </div>
  );
}
