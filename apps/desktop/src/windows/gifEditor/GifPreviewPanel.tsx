import type { RefObject } from 'react';
import {
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
} from 'lucide-react';

import { GifCropOverlay } from '@/components/Editor/GifCropOverlay';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { formatDuration } from './frameOps';
import type { GifData, UiState } from './types';

type GifLoaderData = GifData;

interface GifPreviewPanelProps {
  gifData: GifLoaderData | null;
  cropEditing: boolean;
  crop: UiState['crop'];
  previewCanvasRef: RefObject<HTMLCanvasElement | null>;
  rowsCount: number;
  currentFrameIndex: number;
  isPlaying: boolean;
  durationMs: number;
  hasFrameEdits: boolean;
  onCropChange: (crop: NonNullable<UiState['crop']>) => void;
  onTogglePlay: () => void;
  onSeekToFrame: (index: number) => void;
}

function getFramePositionLabel(rowsCount: number, currentFrameIndex: number) {
  return rowsCount > 0 ? `${currentFrameIndex + 1}/${rowsCount}` : '0/0';
}

function GifTransportButton({
  label,
  title,
  disabled,
  onClick,
  children,
}: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={title}
    >
      {children}
    </Button>
  );
}

function getFirstGifTransportButton(hasRows: boolean, onSeekToFrame: (index: number) => void) {
  return {
    key: 'first',
    label: 'First frame',
    title: 'First frame (Home)',
    disabled: !hasRows,
    onClick: () => onSeekToFrame(0),
    icon: ChevronFirst,
  };
}

function getPreviousGifTransportButton(
  hasRows: boolean,
  currentFrameIndex: number,
  onSeekToFrame: (index: number) => void
) {
  return {
    key: 'previous',
    label: 'Previous frame',
    title: 'Previous frame',
    disabled: !hasRows || currentFrameIndex === 0,
    onClick: () => onSeekToFrame(Math.max(0, currentFrameIndex - 1)),
    icon: ChevronLeft,
  };
}

function getPlayGifTransportButton(
  hasRows: boolean,
  isPlaying: boolean,
  onTogglePlay: () => void
) {
  return {
    key: 'play',
    label: isPlaying ? 'Pause' : 'Play',
    title: isPlaying ? 'Pause (Space)' : 'Play (Space)',
    disabled: !hasRows,
    onClick: onTogglePlay,
    icon: isPlaying ? Pause : Play,
  };
}

function getNextGifTransportButton(
  hasRows: boolean,
  rowsCount: number,
  currentFrameIndex: number,
  onSeekToFrame: (index: number) => void
) {
  return {
    key: 'next',
    label: 'Next frame',
    title: 'Next frame',
    disabled: !hasRows || currentFrameIndex >= rowsCount - 1,
    onClick: () => onSeekToFrame(Math.min(rowsCount - 1, currentFrameIndex + 1)),
    icon: ChevronRight,
  };
}

function getLastGifTransportButton(
  hasRows: boolean,
  rowsCount: number,
  onSeekToFrame: (index: number) => void
) {
  return {
    key: 'last',
    label: 'Last frame',
    title: 'Last frame (End)',
    disabled: !hasRows,
    onClick: () => onSeekToFrame(Math.max(0, rowsCount - 1)),
    icon: ChevronLast,
  };
}

function getGifTransportButtons({
  rowsCount,
  currentFrameIndex,
  isPlaying,
  hasRows,
  onTogglePlay,
  onSeekToFrame,
}: {
  rowsCount: number;
  currentFrameIndex: number;
  isPlaying: boolean;
  hasRows: boolean;
  onTogglePlay: () => void;
  onSeekToFrame: (index: number) => void;
}) {
  return [
    getFirstGifTransportButton(hasRows, onSeekToFrame),
    getPreviousGifTransportButton(hasRows, currentFrameIndex, onSeekToFrame),
    getPlayGifTransportButton(hasRows, isPlaying, onTogglePlay),
    getNextGifTransportButton(hasRows, rowsCount, currentFrameIndex, onSeekToFrame),
    getLastGifTransportButton(hasRows, rowsCount, onSeekToFrame),
  ];
}

function GifTransportControls({
  rowsCount,
  currentFrameIndex,
  isPlaying,
  onTogglePlay,
  onSeekToFrame,
}: Pick<
  GifPreviewPanelProps,
  'rowsCount' | 'currentFrameIndex' | 'isPlaying' | 'onTogglePlay' | 'onSeekToFrame'
>) {
  const hasRows = rowsCount > 0;
  const transportButtons = getGifTransportButtons({
    rowsCount,
    currentFrameIndex,
    isPlaying,
    hasRows,
    onTogglePlay,
    onSeekToFrame,
  });

  return (
    <div className="flex items-center gap-0.5">
      {transportButtons.map(({ key, icon: Icon, ...button }) => (
        <GifTransportButton key={key} {...button}>
          <Icon className="w-4 h-4" />
        </GifTransportButton>
      ))}
    </div>
  );
}

function GifTransportStatus({
  durationMs,
  hasFrameEdits,
}: Pick<GifPreviewPanelProps, 'durationMs' | 'hasFrameEdits'>) {
  return (
    <div className="text-xs text-(--ink-muted) whitespace-nowrap">
      {formatDuration(durationMs)}
      {hasFrameEdits && <span className="ml-2 text-(--accent-400)">edited</span>}
    </div>
  );
}

function GifTransportBar({
  rowsCount,
  currentFrameIndex,
  isPlaying,
  durationMs,
  hasFrameEdits,
  onTogglePlay,
  onSeekToFrame,
}: Omit<GifPreviewPanelProps, 'gifData' | 'cropEditing' | 'crop' | 'previewCanvasRef' | 'onCropChange'>) {
  return (
    <div className="px-6 py-3 flex items-center gap-3 border-t border-(--polar-mist)">
      <GifTransportControls
        rowsCount={rowsCount}
        currentFrameIndex={currentFrameIndex}
        isPlaying={isPlaying}
        onTogglePlay={onTogglePlay}
        onSeekToFrame={onSeekToFrame}
      />

      <div className="text-xs tabular-nums text-(--ink-muted) min-w-[60px]">
        {getFramePositionLabel(rowsCount, currentFrameIndex)}
      </div>

      <div className="flex-1 min-w-0">
        <Slider
          value={[currentFrameIndex]}
          min={0}
          max={Math.max(0, rowsCount - 1)}
          step={1}
          onValueChange={(value) => onSeekToFrame(value[0])}
        />
      </div>

      <GifTransportStatus durationMs={durationMs} hasFrameEdits={hasFrameEdits} />
    </div>
  );
}
export function GifPreviewPanel({
  gifData,
  cropEditing,
  crop,
  previewCanvasRef,
  rowsCount,
  currentFrameIndex,
  isPlaying,
  durationMs,
  hasFrameEdits,
  onCropChange,
  onTogglePlay,
  onSeekToFrame,
}: GifPreviewPanelProps) {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex-1 flex items-center justify-center overflow-hidden p-6">
        {gifData && (
          <>
            <canvas
              ref={previewCanvasRef}
              className="max-w-full max-h-full object-contain shadow-lg"
              style={{ imageRendering: 'pixelated' }}
            />
            {cropEditing && crop && (
              <GifCropOverlay
                canvasEl={previewCanvasRef.current}
                sourceWidth={gifData.width}
                sourceHeight={gifData.height}
                crop={crop}
                onChange={onCropChange}
              />
            )}
          </>
        )}
      </div>

      <GifTransportBar
        rowsCount={rowsCount}
        currentFrameIndex={currentFrameIndex}
        isPlaying={isPlaying}
        durationMs={durationMs}
        hasFrameEdits={hasFrameEdits}
        onTogglePlay={onTogglePlay}
        onSeekToFrame={onSeekToFrame}
      />
    </div>
  );
}
