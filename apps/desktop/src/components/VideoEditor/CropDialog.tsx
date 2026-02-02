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
import type { CropConfig, CompositionConfig } from '../../types';

interface CropDialogProps {
  open: boolean;
  onClose: () => void;
  onApply: (crop: CropConfig, composition: CompositionConfig) => void;
  /** Original video width (before crop) */
  videoWidth: number;
  /** Original video height (before crop) */
  videoHeight: number;
  initialCrop?: CropConfig;
  initialComposition?: CompositionConfig;
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

// Composition presets - fixed resolutions and aspect ratios
const COMPOSITION_PRESETS = [
  { label: 'Auto', value: 'auto', ratio: null, width: null, height: null, description: 'Match video crop' },
  { label: '1080p', value: '1080p', ratio: 16 / 9, width: 1920, height: 1080, description: '1920×1080' },
  { label: '720p', value: '720p', ratio: 16 / 9, width: 1280, height: 720, description: '1280×720' },
  { label: '4K', value: '4k', ratio: 16 / 9, width: 3840, height: 2160, description: '3840×2160' },
  { label: '16:9', value: '16:9', ratio: 16 / 9, width: null, height: null, description: 'Widescreen (fit video)' },
  { label: '9:16', value: '9:16', ratio: 9 / 16, width: null, height: null, description: 'Portrait/TikTok' },
  { label: '1:1', value: '1:1', ratio: 1, width: null, height: null, description: 'Square/Instagram' },
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
  initialComposition,
  videoPath,
}: CropDialogProps) {
  // Default composition (auto mode)
  const defaultComposition: CompositionConfig = useMemo(() => ({
    mode: 'auto',
    aspectRatio: null,
    aspectPreset: null,
    width: null,
    height: null,
  }), []);

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

  // Use initialComposition or default
  const computeInitialComposition = useCallback(() => {
    if (initialComposition) {
      return initialComposition;
    }
    return defaultComposition;
  }, [initialComposition, defaultComposition]);

  const [crop, setCrop] = useState<CropConfig>(computeInitialCrop);
  const [displayCrop, setDisplayCrop] = useState<CropConfig>(computeInitialCrop);
  const [composition, setComposition] = useState<CompositionConfig>(computeInitialComposition);
  const [snappedRatio, setSnappedRatio] = useState<[number, number] | null>(null);
  const animationRef = useRef<number | null>(null);

  // Reset crop and composition when dialog opens
  useEffect(() => {
    if (open) {
      const initialCropVal = computeInitialCrop();
      setCrop(initialCropVal);
      setDisplayCrop(initialCropVal);
      setComposition(computeInitialComposition());
      setSnappedRatio(null);
    }
  }, [open, computeInitialCrop, computeInitialComposition]);

  // Animate crop changes
  const animateTo = useCallback((target: CropConfig) => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
    }

    const start = { ...displayCrop };
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / ANIMATION_DURATION);
      const eased = easeOutCubic(progress);

      setDisplayCrop({
        ...target,
        x: Math.round(start.x + (target.x - start.x) * eased),
        y: Math.round(start.y + (target.y - start.y) * eased),
        width: Math.round(start.width + (target.width - start.width) * eased),
        height: Math.round(start.height + (target.height - start.height) * eased),
      });

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        animationRef.current = null;
      }
    };

    animationRef.current = requestAnimationFrame(animate);
  }, [displayCrop]);

  const handleCropChange = useCallback((newCrop: CropConfig, animate = true) => {
    setCrop(newCrop);
    if (animate) {
      animateTo(newCrop);
    } else {
      setDisplayCrop(newCrop);
    }
  }, [animateTo]);

  const handleAspectPreset = useCallback((value: string | null) => {
    if (value === null || value === '') {
      // Free aspect
      const newCrop = {
        ...crop,
        lockAspectRatio: false,
        aspectRatio: null,
      };
      handleCropChange(newCrop, true);
      setSnappedRatio(null);
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
      setSnappedRatio(null);
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
      setSnappedRatio(null);
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
    setSnappedRatio(null);
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

  const handleCompositionPreset = useCallback((presetValue: string) => {
    const preset = COMPOSITION_PRESETS.find(p => p.value === presetValue);
    if (!preset) return;

    if (preset.value === 'auto') {
      setComposition({
        mode: 'auto',
        aspectRatio: null,
        aspectPreset: null,
        width: null,
        height: null,
      });
    } else {
      setComposition({
        mode: 'manual',
        aspectRatio: preset.ratio,
        aspectPreset: preset.value,
        width: preset.width,
        height: preset.height,
      });
    }
  }, []);

  const handleApply = useCallback(() => {
    const finalCrop: CropConfig = {
      ...crop,
      enabled: crop.width !== videoWidth || crop.height !== videoHeight || crop.x !== 0 || crop.y !== 0,
    };
    console.log('[CropDialog] Applying composition:', composition);
    console.log('[CropDialog] Applying crop:', finalCrop);
    onApply(finalCrop, composition);
    onClose();
  }, [crop, composition, videoWidth, videoHeight, onApply, onClose]);

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
            Crop the video content. The cropped video will be placed within the composition canvas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Crop preview */}
          <div className="flex justify-center">
            <CropPreview
              crop={crop}
              displayCrop={displayCrop}
              onCropChange={handleCropChange}
              videoWidth={videoWidth}
              videoHeight={videoHeight}
              videoPath={videoPath}
              snappedRatio={snappedRatio}
              onSnappedRatioChange={setSnappedRatio}
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

          {/* Composition aspect ratio (output canvas) */}
          <div className="space-y-2">
            <Label>Composition (Output Canvas)</Label>
            <ToggleGroup
              type="single"
              value={composition.mode === 'auto' ? 'auto' : (composition.aspectPreset || '')}
              onValueChange={handleCompositionPreset}
              className="justify-start flex-wrap"
            >
              {COMPOSITION_PRESETS.map((preset) => (
                <ToggleGroupItem
                  key={preset.value}
                  value={preset.value}
                  className="text-xs"
                  title={preset.description}
                >
                  {preset.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {composition.mode === 'manual' && (
              <p className="text-xs text-[var(--ink-muted)]">
                {composition.width && composition.height
                  ? `Output: ${composition.width}×${composition.height}`
                  : `Cropped video will be centered within a ${composition.aspectPreset} canvas`}
              </p>
            )}
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
