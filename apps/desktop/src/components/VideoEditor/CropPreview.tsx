import { memo, useCallback, useRef, useState, useEffect, useMemo } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CropConfig } from '../../types';

type DragType = 'move' | 'resize-tl' | 'resize-tr' | 'resize-bl' | 'resize-br' | 'resize-t' | 'resize-b' | 'resize-l' | 'resize-r' | null;

export interface CropPreviewProps {
  crop: CropConfig;
  displayCrop: CropConfig; // Animated display values
  onCropChange: (crop: CropConfig, animate?: boolean) => void;
  onDragEnd: () => void;
  videoWidth: number;
  videoHeight: number;
  videoPath?: string;
}

/**
 * CropPreview - Visual cropper component with draggable crop rectangle
 * Note: This crops the video content only. Webcam overlay is added during composition.
 */
export const CropPreview = memo(function CropPreview({
  crop,
  displayCrop,
  onCropChange,
  onDragEnd,
  videoWidth,
  videoHeight,
  videoPath,
}: CropPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragType, setDragType] = useState<DragType>(null);
  const dragStartRef = useRef<{ x: number; y: number; crop: CropConfig } | null>(null);
  const rafRef = useRef<number | null>(null);

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

  // Cleanup pending rAF on unmount
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

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

    // Track latest mouse position for rAF coalescing
    const latestPos = { clientX: e.clientX, clientY: e.clientY };

    const processDrag = () => {
      if (!dragStartRef.current) return;

      const deltaX = (latestPos.clientX - dragStartRef.current.x) / scale;
      const deltaY = (latestPos.clientY - dragStartRef.current.y) / scale;

      const startCrop = dragStartRef.current.crop;
      const newCrop = { ...crop };

      const minSize = 50;
      const rightEdge = startCrop.x + startCrop.width;
      const bottomEdge = startCrop.y + startCrop.height;

      // Round the moving edge first, then derive the linked dimension
      // so the pinned (opposite) edge never shifts.
      switch (type) {
        case 'move':
          newCrop.x = Math.round(Math.max(0, Math.min(videoWidth - startCrop.width, startCrop.x + deltaX)));
          newCrop.y = Math.round(Math.max(0, Math.min(videoHeight - startCrop.height, startCrop.y + deltaY)));
          break;

        case 'resize-tl': {
          newCrop.x = Math.round(Math.max(0, Math.min(rightEdge - minSize, startCrop.x + deltaX)));
          newCrop.y = Math.round(Math.max(0, Math.min(bottomEdge - minSize, startCrop.y + deltaY)));
          newCrop.width = rightEdge - newCrop.x;
          newCrop.height = bottomEdge - newCrop.y;
          break;
        }

        case 'resize-tr': {
          newCrop.y = Math.round(Math.max(0, Math.min(bottomEdge - minSize, startCrop.y + deltaY)));
          newCrop.width = Math.round(Math.max(minSize, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX)));
          newCrop.height = bottomEdge - newCrop.y;
          break;
        }

        case 'resize-bl': {
          newCrop.x = Math.round(Math.max(0, Math.min(rightEdge - minSize, startCrop.x + deltaX)));
          newCrop.width = rightEdge - newCrop.x;
          newCrop.height = Math.round(Math.max(minSize, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY)));
          break;
        }

        case 'resize-br':
          newCrop.width = Math.round(Math.max(minSize, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX)));
          newCrop.height = Math.round(Math.max(minSize, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY)));
          break;

        case 'resize-t':
          newCrop.y = Math.round(Math.max(0, Math.min(bottomEdge - minSize, startCrop.y + deltaY)));
          newCrop.height = bottomEdge - newCrop.y;
          break;

        case 'resize-b':
          newCrop.height = Math.round(Math.max(minSize, Math.min(videoHeight - startCrop.y, startCrop.height + deltaY)));
          break;

        case 'resize-l':
          newCrop.x = Math.round(Math.max(0, Math.min(rightEdge - minSize, startCrop.x + deltaX)));
          newCrop.width = rightEdge - newCrop.x;
          break;

        case 'resize-r':
          newCrop.width = Math.round(Math.max(minSize, Math.min(videoWidth - startCrop.x, startCrop.width + deltaX)));
          break;
      }

      // Apply aspect ratio constraint if locked
      if (crop.lockAspectRatio && crop.aspectRatio) {
        const isVerticalResize = type === 'resize-t' || type === 'resize-b';
        const isHorizontalResize = type === 'resize-l' || type === 'resize-r';

        if (isVerticalResize) {
          newCrop.width = Math.round(newCrop.height * crop.aspectRatio);
        } else if (isHorizontalResize) {
          newCrop.height = Math.round(newCrop.width / crop.aspectRatio);
        } else {
          newCrop.height = Math.round(newCrop.width / crop.aspectRatio);
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
      }

      onCropChange(newCrop, false);
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestPos.clientX = moveEvent.clientX;
      latestPos.clientY = moveEvent.clientY;

      // Coalesce rapid mousemove events into one update per frame
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        processDrag();
      });
    };

    const handleMouseUp = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Process final position so we don't lose the last movement
      processDrag();
      setDragType(null);
      dragStartRef.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      // Commit final crop to parent state (deferred during drag)
      onDragEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [crop, scale, videoWidth, videoHeight, onCropChange, onDragEnd]);

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

      {/* Dark overlay — 4 simple boxes instead of expensive clip-path polygon */}
      <div className="absolute pointer-events-none bg-black/60" style={{ left: 0, top: 0, right: 0, height: cropTop }} />
      <div className="absolute pointer-events-none bg-black/60" style={{ left: 0, top: cropTop + cropHeight, right: 0, bottom: 0 }} />
      <div className="absolute pointer-events-none bg-black/60" style={{ left: 0, top: cropTop, width: cropLeft, height: cropHeight }} />
      <div className="absolute pointer-events-none bg-black/60" style={{ left: cropLeft + cropWidth, top: cropTop, right: 0, height: cropHeight }} />

      {/* Crop rectangle */}
      <div
        className="absolute border-2 border-white"
        style={{
          transform: `translate3d(${cropLeft}px, ${cropTop}px, 0)`,
          width: cropWidth,
          height: cropHeight,
          cursor: dragType === 'move' ? 'grabbing' : 'grab',
          willChange: dragType ? 'transform, width, height' : 'auto',
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
          className="absolute top-1/2 -left-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-l')}
        />
        <div
          className="absolute top-1/2 -right-1 w-2 h-6 -translate-y-1/2 bg-white rounded-full cursor-ew-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-r')}
        />
        <div
          className="absolute left-1/2 -top-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize"
          onMouseDown={(e) => handleMouseDown(e, 'resize-t')}
        />
        <div
          className="absolute left-1/2 -bottom-1 w-6 h-2 -translate-x-1/2 bg-white rounded-full cursor-ns-resize"
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

        {/* Size indicator */}
        <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 bg-black/80 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
          {displayCrop.width} × {displayCrop.height}
        </div>
      </div>
    </div>
  );
});
