import React from 'react';
import { Download, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatDuration, formatFileSize, qualityLabel } from './frameOps';
import type { ExportPreviewState, GifData, UiState } from './types';

interface ExportPreviewDialogProps {
  preview: ExportPreviewState | null;
  gifData: GifData | null;
  ui: UiState;
  setUi: React.Dispatch<React.SetStateAction<UiState>>;
  isExporting: boolean;
  estimatedBytes: number | null;
  estimating: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onSave: () => void;
  onClose: () => void;
}

export const ExportPreviewDialog: React.FC<ExportPreviewDialogProps> = ({
  preview,
  gifData,
  ui,
  setUi,
  isExporting,
  estimatedBytes,
  estimating,
  canvasRef,
  onSave,
  onClose,
}) => (
  <Dialog
    open={!!preview}
    onOpenChange={(next) => {
      if (!next && !isExporting) onClose();
    }}
  >
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>
          {preview?.scope === 'selection'
            ? 'Export selected frames'
            : 'Export GIF'}
        </DialogTitle>
        <DialogDescription>
          Preview the output before saving. Playback loops at the configured
          speed.
        </DialogDescription>
      </DialogHeader>

      {preview &&
        gifData &&
        (() => {
          const swap = ui.rotation === 90 || ui.rotation === 270;
          const cropW = ui.crop?.w ?? gifData.width;
          const cropH = ui.crop?.h ?? gifData.height;
          const usingExplicit =
            ui.outputWidth !== cropW || ui.outputHeight !== cropH;
          const baseW = usingExplicit ? ui.outputWidth : cropW;
          const baseH = usingExplicit ? ui.outputHeight : cropH;
          const outW = Math.max(1, Math.round(swap ? baseH : baseW));
          const outH = Math.max(1, Math.round(swap ? baseW : baseH));
          const speed = Math.max(0.05, ui.speed);
          const totalDelayMs = preview.rows.reduce(
            (acc, r) => acc + Math.max(1, Math.round(r.delayMs / speed)),
            0,
          );
          return (
            <div className="flex gap-4">
              <div className="flex-1 min-w-0 flex items-center justify-center bg-(--polar-mist)/40 rounded-md p-3 min-h-[260px]">
                <canvas
                  ref={canvasRef}
                  className="max-w-full max-h-[320px] object-contain shadow-md"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
              <div className="w-56 shrink-0 flex flex-col gap-3 text-sm">
                <dl className="grid grid-cols-2 gap-y-1">
                  <dt className="text-(--ink-muted)">Frames</dt>
                  <dd className="tabular-nums">{preview.rows.length}</dd>
                  <dt className="text-(--ink-muted)">Duration</dt>
                  <dd className="tabular-nums">{formatDuration(totalDelayMs)}</dd>
                  <dt className="text-(--ink-muted)">Dimensions</dt>
                  <dd className="tabular-nums">
                    {outW} × {outH}
                  </dd>
                  {ui.rotation !== 0 && (
                    <>
                      <dt className="text-(--ink-muted)">Rotation</dt>
                      <dd>{ui.rotation}°</dd>
                    </>
                  )}
                  {(ui.flipH || ui.flipV) && (
                    <>
                      <dt className="text-(--ink-muted)">Flip</dt>
                      <dd>
                        {[ui.flipH && 'H', ui.flipV && 'V']
                          .filter(Boolean)
                          .join(' + ')}
                      </dd>
                    </>
                  )}
                  {ui.speed !== 1 && (
                    <>
                      <dt className="text-(--ink-muted)">Speed</dt>
                      <dd>{ui.speed.toFixed(2)}×</dd>
                    </>
                  )}
                  <dt className="text-(--ink-muted)">Loop</dt>
                  <dd>{ui.loopForever ? 'Forever' : 'Once'}</dd>
                </dl>

                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Quality</Label>
                    <span className="text-xs text-(--ink-muted) tabular-nums">
                      {Math.round(ui.qualityValue)}
                    </span>
                  </div>
                  <Slider
                    value={[ui.qualityValue]}
                    min={1}
                    max={100}
                    step={1}
                    onValueChange={(v) =>
                      setUi((p) => ({ ...p, qualityValue: v[0] }))
                    }
                  />
                  <span className="text-[10px] text-(--ink-muted)">
                    {qualityLabel(ui.qualityValue)}
                  </span>
                </div>

                <div className="flex flex-col gap-1 mt-1">
                  <Label className="text-xs">Preview size</Label>
                  <div className="relative rounded-md border border-(--polar-mist) bg-(--polar-mist)/30 h-7 overflow-hidden">
                    {estimating && (
                      <div className="absolute inset-0 bg-(--accent-400)/15 animate-pulse" />
                    )}
                    <div className="relative h-full flex items-center justify-center px-2 text-sm tabular-nums">
                      {estimatedBytes !== null ? (
                        <span>
                          {estimating ? 'Calculating… ' : ''}
                          {formatFileSize(estimatedBytes)}
                        </span>
                      ) : estimating ? (
                        <span className="flex items-center gap-2 text-(--ink-muted) text-xs">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          Calculating…
                        </span>
                      ) : (
                        <span className="text-xs text-(--ink-muted)">—</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-2 mt-1 pt-3 border-t border-(--polar-mist)">
                  <span className="text-xs uppercase tracking-wide text-(--ink-muted)">
                    Make file smaller
                  </span>

                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={ui.limitFps}
                        onChange={(e) =>
                          setUi((p) => ({ ...p, limitFps: e.target.checked }))
                        }
                      />
                      Limit frames/sec
                    </label>
                    <div className="flex items-center gap-2 pl-5">
                      <Input
                        type="number"
                        min={1}
                        max={60}
                        step={1}
                        value={ui.fpsCap}
                        disabled={!ui.limitFps}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n > 0) {
                            setUi((p) => ({
                              ...p,
                              fpsCap: Math.max(1, Math.min(60, Math.round(n))),
                            }));
                          }
                        }}
                        className="h-7 text-xs w-20"
                      />
                      <span className="text-[10px] text-(--ink-muted)">fps</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={ui.capFrameTime}
                        onChange={(e) =>
                          setUi((p) => ({ ...p, capFrameTime: e.target.checked }))
                        }
                      />
                      Cap frame time
                    </label>
                    <div className="flex items-center gap-2 pl-5">
                      <Input
                        type="number"
                        min={0.01}
                        max={60}
                        step={0.1}
                        value={ui.maxFrameTimeSec}
                        disabled={!ui.capFrameTime}
                        onChange={(e) => {
                          const n = Number(e.target.value);
                          if (Number.isFinite(n) && n > 0) {
                            setUi((p) => ({
                              ...p,
                              maxFrameTimeSec: Math.min(60, n),
                            }));
                          }
                        }}
                        className="h-7 text-xs w-20"
                      />
                      <span className="text-[10px] text-(--ink-muted)">sec</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={isExporting}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={isExporting}>
          {isExporting ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Exporting…
            </>
          ) : (
            <>
              <Download className="w-4 h-4 mr-2" />
              Save…
            </>
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
