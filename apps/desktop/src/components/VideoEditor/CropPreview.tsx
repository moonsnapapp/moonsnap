import { memo, useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CropConfig } from '../../types';

// Common aspect ratios for snapping
const COMMON_RATIOS: [number, number][] = [
  [1, 1],
  [4, 3],
  [3, 2],
  [16, 9],
  [9, 16],
  [16, 10],
  [21, 9],
];

// Snap threshold for aspect ratio detection
const SNAP_THRESHOLD = 0.03;

/**
 * Find closest common aspect ratio within threshold
 */
function findClosestRatio(width: number, height: number): [number, number] | null {
  const currentRatio = width / height;
  for (const [w, h] of COMMON_RATIOS) {
    const ratio = w / h;
    if (Math.abs(currentRatio - ratio) < SNAP_THRESHOLD) {
      return [w, h];
    }
    // Also check inverted
    const invertedRatio = h / w;
    if (Math.abs(currentRatio - invertedRatio) < SNAP_THRESHOLD) {
      return [h, w];
    }
  }
  return null;
}

type DragType = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r' | null;

export interface CropPreviewProps {
  crop: CropConfig;
  displayCrop: CropConfig; // Animated display values
  onCropChange: (crop: CropConfig, animate?: boolean) => void;
  videoWidth: number;
  videoHeight: number;
  videoPath?: string;
  snappedRatio: [number, number] | null;
  onSnappedRatioChange: (ratio: [number, number] | null) => void;
}

/**
 * CropPreview - Visual cropper component with draggable crop rectangle
 * Note: This crops the video content only. Webcam overlay is added during composition.
 */
export const CropPreview = memo(function CropPreview({
  crop,
  displayCrop,
  onCropChange,
  videoWidth,
  videoHeight,
  videoPath,
  snappedRatio,
  onSnappedRatioChange,
}: CropPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragType, setDragType] = useState<DragType>(null);
  const dragStartRef = useRef<{ x: number; y: number; crop: CropConfig } | null>(null);

  // Calculate scale factor to fit video in preview area
  const maxPreviewWidth = 600;
  const maxPreviewHeight = 400;
  const scaleX = maxPreviewWidth / videoWidth;
  const scaleY = maxPreviewHeight / videoHeight;
  const scale = Math.min(scaleX, scaleY, 1);

  const previewWidth = videoWidth * scale;
  const previewHeight = videoHeight * scale;

  // Convert crop to preview coordinates (use animated displayCrop)
  const cropLeft = displayCrop.x * scale;
  const cropTop = displayCrop.y * scale;
  const cropWidth = displayCrop.width * scale;
  const cropHeight = displayCrop.height * scale;

  // Set video to first frame
  useEffect(() => {
    if (videoRef.current && videoPath) {
      videoRef.current.currentTime = 0;
    }
  }, [videoPath]);

  const handleMouseDown = useCallback((
    e: React.MouseEvent,
    type: DragType
  ) => {
    e.preventDefault();
    e.stopPropagation();

    setDragType(type);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      crop: { ...crop },
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!dragStartRef.current || !containerRef.current) return;

      const deltaX = (moveEvent.clientX - dragStartRef.current.x) / scale;
      const deltaY = (moveEvent.clientY - dragStartRef.current.y) / scale;

      const startCrop = dragStartRef.current.crop;
      const newCrop = { ...crop };

      const minSize = 50; // Minimum crop size in pixels

      switch (type) {
        case 'move':
          newCrop.x = Math.max(0, Math.min(videoWidth - startCrop.width, startCrop.x + deltaX));
          newCrop.y = Math.max(0, Math.min(videoHeight - startCrop.height, startCrop.y + deltaY));
          break;

        case 'resize-tl': {
          newCrop.x = Math.max(0, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + deltaX));
          newCrop.y = Math.max(0, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + deltaY));
          newCrop.width = startCrop.x + startCrop.width - newCrop.x;
          newCrop.height = startCrop.y + startCrop.height - newCrop.y;
          break;
        }

        case 'resize-tr': {
          newCrop.y = Math.max(0, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + deltaY));
          newCrop.width = Math.max(minSize, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX));
          newCrop.height = startCrop.y + startCrop.height - newCrop.y;
          break;
        }

        case 'resize-bl': {
          newCrop.x = Math.max(0, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + deltaX));
          newCrop.width = startCrop.x + startCrop.width - newCrop.x;
          newCrop.height = Math.max(minSize, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY));
          break;
        }

        case 'resize-br':
          newCrop.width = Math.max(minSize, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX));
          newCrop.height = Math.max(minSize, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY));
          break;

        case 'resize-t':
          newCrop.y = Math.max(0, Math.min(startCrop.y + startCrop.height - minSize, startCrop.y + deltaY));
          newCrop.height = startCrop.y + startCrop.height - newCrop.y;
          break;

        case 'resize-b':
          newCrop.height = Math.max(minSize, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY));
          break;

        case 'resize-l':
          newCrop.x = Math.max(0, Math.min(startCrop.x + startCrop.width - minSize, startCrop.x + deltaX));
          newCrop.width = startCrop.x + startCrop.width - newCrop.x;
          break;

        case 'resize-r':
          newCrop.width = Math.max(minSize, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX));
          break;
      }

      // Round values
      newCrop.x = Math.round(newCrop.x);
      newCrop.y = Math.round(newCrop.y);
      newCrop.width = Math.round(newCrop.width);
      newCrop.height = Math.round(newCrop.height);

      // Apply aspect ratio constraint if locked
      if (crop.lockAspectRatio && crop.aspectRatio) {
        const isVerticalResize = type === 'resize-t' || type === 'resize-b';
        const isHorizontalResize = type === 'resize-l' || type === 'resize-r';

        if (isVerticalResize) {
          newCrop.width = Math.round(newCrop.height * crop.aspectRatio);
        } else if (isHorizontalResize) {
          newCrop.height = Math.round(newCrop.width / crop.aspectRatio);
        } else {
          // Corner resize - use dominant direction
          const targetHeight = newCrop.width / crop.aspectRatio;
          newCrop.height = Math.round(targetHeight);
        }

        // Ensure we don't exceed bounds after ratio adjustment
        if (newCrop.x + newCrop.width > videoWidth) {
          newCrop.width = videoWidth - newCrop.x;
          newCrop.height = Math.round(newCrop.width / crop.aspectRatio);
        }
        if (newCrop.y + newCrop.height > videoHeight) {
          newCrop.height = videoHeight - newCrop.y;
          newCrop.width = Math.round(newCrop.height * crop.aspectRatio);
        }
      } else if (type !== 'move') {
        // Free resize - check for snap to common ratios
        const snapRatio = findClosestRatio(newCrop.width, newCrop.height);
        if (snapRatio && !snappedRatio) {
          onSnappedRatioChange(snapRatio);
        } else if (!snapRatio && snappedRatio) {
          onSnappedRatioChange(null);
        }

        // Apply snap if detected
        if (snapRatio) {
          const targetRatio = snapRatio[0] / snapRatio[1];
          const isVerticalDominant = type === 'resize-t' || type === 'resize-b';
          if (isVerticalDominant) {
            newCrop.width = Math.round(newCrop.height * targetRatio);
          } else {
            newCrop.height = Math.round(newCrop.width / targetRatio);
          }
        }
      }

      onCropChange(newCrop, false); // Don't animate during drag
    };

    const handleMouseUp = () => {
      setDragType(null);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [crop, scale, videoWidth, videoHeight, onCropChange, snappedRatio, onSnappedRatioChange]);

  const videoSrc = useMemo(() => {
    if (!videoPath) return undefined;
    return convertFileSrc(videoPath);
  }, [videoPath]);

  return (
    <div
      ref={containerRef}
      className="relative bg-[var(--polar-steel)] rounded-lg overflow-hidden"
      style={{ width: previewWidth, height: previewHeight }}
    >
      {/* Video preview */}
      {videoSrc ? (
        <video
          ref={videoRef}
          src={videoSrc}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ pointerEvents: 'none' }}
          muted
          playsInline
          preload="metadata"
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-[var(--ink-muted)]">
          <span className="text-sm">Video Preview</span>
        </div>
      )}

      {/* Dark overlay outside crop area */}
      <div
        className="absolute inset-0 bg-black/60 pointer-events-none"
        style={{
          clipPath: `polygon(
            0 0, 100% 0, 100% 100%, 0 100%, 0 0,
            ${cropLeft}px ${cropTop}px,
            ${cropLeft}px ${cropTop + cropHeight}px,
            ${cropLeft + cropWidth}px ${cropTop + cropHeight}px,
            ${cropLeft + cropWidth}px ${cropTop}px,
            ${cropLeft}px ${cropTop}px
          )`,
        }}
      />

      {/* Crop rectangle */}
      <div
        className="absolute border-2 border-white shadow-lg"
        style={{
          left: cropLeft,
          top: cropTop,
          width: cropWidth,
          height: cropHeight,
          cursor: dragType === 'move' ? 'grabbing' : 'grab',
        }}
      >
        {/* Move area */}
        <div
          className="absolute inset-2 cursor-grab active:cursor-grabbing"
          onMouseDown={(e) => handleMouseDown(e, 'move')}
        />

        {/* Corner handles - L-shaped like Cap */}
        {/* Top-left */}
        <div
          className="absolute -left-0.5 -top-0.5 w-5 h-5 cursor-nwse-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-tl')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M2 2 H14 M2 2 V14" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>
        {/* Top-right */}
        <div
          className="absolute -right-0.5 -top-0.5 w-5 h-5 cursor-nesw-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-tr')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M18 2 H6 M18 2 V14" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>
        {/* Bottom-left */}
        <div
          className="absolute -left-0.5 -bottom-0.5 w-5 h-5 cursor-nesw-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-bl')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M2 18 H14 M2 18 V6" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>
        {/* Bottom-right */}
        <div
          className="absolute -right-0.5 -bottom-0.5 w-5 h-5 cursor-nwse-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-br')}
        >
          <svg viewBox="0 0 20 20" className="w-full h-full drop-shadow-md">
            <path d="M18 18 H6 M18 18 V6" stroke="white" strokeWidth="3" strokeLinecap="square" fill="none" />
          </svg>
        </div>

        {/* Edge handles */}
        <div
          className="absolute top-1/2 -left-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize shadow"
          onMouseDown={(e) => handleMouseDown(e, 'resize-l')}
        />
        <div
          className="absolute top-1/2 -right-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize shadow"
          onMouseDown={(e) => handleMouseDown(e, 'resize-r')}
        />
        <div
          className="absolute left-1/2 -top-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize shadow"
          onMouseDown={(e) => handleMouseDown(e, 'resize-t')}
        />
        <div
          className="absolute left-1/2 -bottom-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize shadow"
          onMouseDown={(e) => handleMouseDown(e, 'resize-b')}
        />

        {/* Grid lines (rule of thirds) - only show during drag */}
        {dragType && (
          <div className="absolute inset-0 pointer-events-none">
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
          </div>
        )}

        {/* Snapped ratio indicator */}
        {snappedRatio && (
          <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded-full whitespace-nowrap border border-white/30">
            {snappedRatio[0]}:{snappedRatio[1]}
          </div>
        )}

        {/* Size indicator */}
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
          {crop.width} × {crop.height}
        </div>
      </div>
    </div>
  );
});
