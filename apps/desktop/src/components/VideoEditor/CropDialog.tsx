import { memo, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Crop, Lock, Unlock, Maximize2, RotateCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { CropPreview } from './CropPreview';
import type { CropConfig } from '../../types';

interface CropDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (crop: CropConfig) => void;
  /** Original video width (before crop) */
  videoWidth: number;
  /** Original video height (before crop) */
  videoHeight: number;
  initialCrop?: CropConfig;
  videoPath?: string;
}

// Aspect ratio presets for video crop
const ASPECT_PRESETS = [
  { label: 'Free', value: null },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: 'Original', value: 'original' as const },
];

// Animation duration in ms
const ANIMATION_DURATION = 200;

// Easing function
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * CropDialog - Modal dialog for interactive video cropping
 *
 * This crops the VIDEO content only, before composition.
 * The cropped video is then placed in the composition canvas (which may have a different aspect ratio).
 * Webcam overlay is added during composition, not affected by video crop.
 *
 * Crop is non-destructive - stored in project config and applied during export.
 */
export const CropDialog = memo(function CropDialog({
  open,
  onClose,
  onApply,
  videoWidth,
  videoHeight,
  initialCrop,
  videoPath,
}: CropDialogProps) {
  // Compute a sensible default crop (centered, 80% of video size)
  const defaultCrop = useMemo((): CropConfig => {
    const cropWidth = Math.round(videoWidth * 0.8);
    const cropHeight = Math.round(videoHeight * 0.8);
    return {
      enabled: true,
      x: Math.round((videoWidth - cropWidth) / 2),
      y: Math.round((videoHeight - cropHeight) / 2),
      width: cropWidth,
      height: cropHeight,
      lockAspectRatio: false,
      aspectRatio: null,
    };
  }, [videoWidth, videoHeight]);

  // Use initialCrop if valid (has non-zero dimensions), otherwise use default
  const computeInitialCrop = useCallback(() => {
    if (initialCrop && initialCrop.width > 0 && initialCrop.height > 0) {
      return initialCrop;
    }
    return defaultCrop;
  }, [initialCrop, defaultCrop]);

  const [crop, setCrop] = useState<CropConfig>(computeInitialCrop);
  const [displayCrop, setDisplayCrop] = useState<CropConfig>(computeInitialCrop);
  const animationRef = useRef<number | null>(null);
  const displayCropRef = useRef<CropConfig>(computeInitialCrop());
  const pendingCropRef = useRef<CropConfig | null>(null);

  // Reset crop when dialog opens
  useEffect(() => {
    if (open) {
      const initialCropVal = computeInitialCrop();
      setCrop(initialCropVal);
      setDisplayCrop(initialCropVal);
      displayCropRef.current = initialCropVal;
      pendingCropRef.current = null;
    }
  }, [open, computeInitialCrop]);

  // Animate crop changes (uses ref for start value → stable callback)
  const animateTo = useCallback((target: CropConfig) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const start = { ...displayCropRef.current };
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / ANIMATION_DURATION);
      const eased = easeOutCubic(progress);

      const interpolated = {
        ...target,
        x: Math.round(start.x + (target.x - start.x) * eased),
        y: Math.round(start.y + (target.y - start.y) * eased),
        width: Math.round(start.width + (target.width - start.width) * eased),
        height: Math.round(start.height + (target.height - start.height) * eased),
      };

      displayCropRef.current = interpolated;
      setDisplayCrop(interpolated);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, []);

  const handleCropChange = useCallback((newCrop: CropConfig, animate = true) => {
    if (animate) {
      // Committed change (presets, inputs, reset) — update both
      setCrop(newCrop);
      animateTo(newCrop);
    } else {
      // Drag frame — only update visual display, defer crop state
      displayCropRef.current = newCrop;
      setDisplayCrop(newCrop);
      pendingCropRef.current = newCrop;
    }
  }, [animateTo]);

  // Commit pending crop from drag end
  const handleDragEnd = useCallback(() => {
    if (pendingCropRef.current) {
      setCrop(pendingCropRef.current);
      pendingCropRef.current = null;
    }
  }, []);

  const handleAspectPreset = useCallback((value: string | null) => {
    if (value === null || value === '') {
      // Free aspect
      const newCrop = {
        ...crop,
        lockAspectRatio: false,
        aspectRatio: null,
      };
      handleCropChange(newCrop, true);

    } else if (value === 'original') {
      // Original video aspect
      const originalAspect = videoWidth / videoHeight;
      const newHeight = Math.round(crop.width / originalAspect);
      const newCrop = {
        ...crop,
        lockAspectRatio: true,
        aspectRatio: originalAspect,
        height: Math.min(newHeight, videoHeight - crop.y),
      };
      handleCropChange(newCrop, true);

    } else {
      // Specific aspect ratio
      const ratio = parseFloat(value);
      const newHeight = Math.round(crop.width / ratio);

      // Ensure new height fits within bounds
      let finalHeight = Math.min(newHeight, videoHeight - crop.y);
      let finalWidth = Math.round(finalHeight * ratio);

      // If width would exceed bounds, constrain by width instead
      if (crop.x + finalWidth > videoWidth) {
        finalWidth = videoWidth - crop.x;
        finalHeight = Math.round(finalWidth / ratio);
      }

      const newCrop = {
        ...crop,
        lockAspectRatio: true,
        aspectRatio: ratio,
        width: finalWidth,
        height: finalHeight,
      };
      handleCropChange(newCrop, true);

    }
  }, [crop, videoWidth, videoHeight, handleCropChange]);

  const handleToggleLock = useCallback(() => {
    const newCrop = {
      ...crop,
      lockAspectRatio: !crop.lockAspectRatio,
      aspectRatio: crop.lockAspectRatio ? null : crop.width / crop.height,
    };
    handleCropChange(newCrop, false);
  }, [crop, handleCropChange]);

  const handleReset = useCallback(() => {
    const newCrop = {
      enabled: false,
      x: 0,
      y: 0,
      width: videoWidth,
      height: videoHeight,
      lockAspectRatio: false,
      aspectRatio: null,
    };
    handleCropChange(newCrop, true);
  }, [videoWidth, videoHeight, handleCropChange]);

  const handleFill = useCallback(() => {
    // Maximize crop within aspect ratio
    if (crop.lockAspectRatio && crop.aspectRatio) {
      const videoAspect = videoWidth / videoHeight;
      let newCrop: CropConfig;

      if (crop.aspectRatio > videoAspect) {
        // Crop is wider than video - constrain by width
        const newHeight = Math.round(videoWidth / crop.aspectRatio);
        newCrop = {
          ...crop,
          x: 0,
          y: Math.round((videoHeight - newHeight) / 2),
          width: videoWidth,
          height: newHeight,
        };
      } else {
        // Crop is taller than video - constrain by height
        const newWidth = Math.round(videoHeight * crop.aspectRatio);
        newCrop = {
          ...crop,
          x: Math.round((videoWidth - newWidth) / 2),
          y: 0,
          width: newWidth,
          height: videoHeight,
        };
      }
      handleCropChange(newCrop, true);
    } else {
      // No aspect ratio lock, fill entire video
      const newCrop = {
        ...crop,
        x: 0,
        y: 0,
        width: videoWidth,
        height: videoHeight,
      };
      handleCropChange(newCrop, true);
    }
  }, [crop, videoWidth, videoHeight, handleCropChange]);

  const handleApply = useCallback(() => {
    const finalCrop: CropConfig = {
      ...crop,
      enabled: crop.width !== videoWidth || crop.height !== videoHeight || crop.x !== 0 || crop.y !== 0,
    };
    onApply(finalCrop);
    onClose();
  }, [crop, videoWidth, videoHeight, onApply, onClose]);

  // Cleanup animation on unmount
  useEffect(() => {
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-w-[700px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crop className="w-5 h-5" />
            Crop Video
          </DialogTitle>
          <DialogDescription>
            Crop the video content. Crop is non-destructive and applied during export.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Crop preview */}
          <div className="flex justify-center">
            <CropPreview
              crop={crop}
              displayCrop={displayCrop}
              onCropChange={handleCropChange}
              onDragEnd={handleDragEnd}
              videoWidth={videoWidth}
              videoHeight={videoHeight}
              videoPath={videoPath}
            />
          </div>

          {/* Video Crop aspect ratio presets */}
          <div className="space-y-2">
            <Label>Video Crop Aspect Ratio</Label>
            <ToggleGroup
              type="single"
              value={crop.lockAspectRatio ? (crop.aspectRatio?.toString() || 'original') : ''}
              onValueChange={handleAspectPreset}
              className="justify-start flex-wrap"
            >
              {ASPECT_PRESETS.map((preset) => (
                <ToggleGroupItem
                  key={preset.label}
                  value={preset.value?.toString() || ''}
                  className="text-xs"
                >
                  {preset.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>

          {/* Position and size inputs */}
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">X</Label>
              <Input
                type="number"
                value={crop.x}
                onChange={(e) => {
                  const newCrop = { ...crop, x: Math.max(0, parseInt(e.target.value) || 0) };
                  handleCropChange(newCrop, true);
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Y</Label>
              <Input
                type="number"
                value={crop.y}
                onChange={(e) => {
                  const newCrop = { ...crop, y: Math.max(0, parseInt(e.target.value) || 0) };
                  handleCropChange(newCrop, true);
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Width</Label>
              <Input
                type="number"
                value={crop.width}
                onChange={(e) => {
                  const w = Math.max(50, parseInt(e.target.value) || 50);
                  const newCrop = {
                    ...crop,
                    width: w,
                    height: crop.lockAspectRatio && crop.aspectRatio ? Math.round(w / crop.aspectRatio) : crop.height,
                  };
                  handleCropChange(newCrop, true);
                }}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Height</Label>
              <Input
                type="number"
                value={crop.height}
                onChange={(e) => {
                  const h = Math.max(50, parseInt(e.target.value) || 50);
                  const newCrop = {
                    ...crop,
                    height: h,
                    width: crop.lockAspectRatio && crop.aspectRatio ? Math.round(h * crop.aspectRatio) : crop.width,
                  };
                  handleCropChange(newCrop, true);
                }}
                className="h-8"
              />
            </div>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleToggleLock}
              className="gap-1.5"
            >
              {crop.lockAspectRatio ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              {crop.lockAspectRatio ? 'Locked' : 'Unlocked'}
            </Button>
            <Button variant="outline" size="sm" onClick={handleFill} className="gap-1.5">
              <Maximize2 className="w-3.5 h-3.5" />
              Fill
            </Button>
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" />
              Reset
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleApply}>
            Apply Crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
