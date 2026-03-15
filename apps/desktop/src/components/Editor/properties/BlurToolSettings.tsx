import React from 'react';
import { Grid3X3, Layers } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';

interface BlurToolSettingsProps {
  blurType: 'pixelate' | 'gaussian';
  blurAmount: number;
  onBlurTypeChange: (type: 'pixelate' | 'gaussian') => void;
  onBlurAmountChange: (amount: number) => void;
}

const BLUR_INTENSITIES = [
  { label: 'Weak', value: 8 },
  { label: 'Medium', value: 15 },
  { label: 'Strong', value: 25 },
];

export const BlurToolSettings: React.FC<BlurToolSettingsProps> = ({
  blurType,
  blurAmount,
  onBlurTypeChange,
  onBlurAmountChange,
}) => {
  return (
    <>
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Blur Type</Label>
        <div className="flex gap-1.5">
          <button
            onClick={() => onBlurTypeChange('pixelate')}
            className={`editor-choice-pill flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs ${
              blurType === 'pixelate' ? 'editor-choice-pill--active' : ''
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            Pixelate
          </button>
          <button
            onClick={() => onBlurTypeChange('gaussian')}
            className={`editor-choice-pill flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs ${
              blurType === 'gaussian' ? 'editor-choice-pill--active' : ''
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            Gaussian
          </button>
        </div>
      </div>
      <Separator className="bg-[var(--polar-frost)]" />
      <div className="space-y-3">
        <Label className="text-xs text-[var(--ink-muted)] uppercase tracking-wide font-medium">Intensity</Label>
        <div className="flex gap-1.5">
          {BLUR_INTENSITIES.map(({ label, value }) => (
            <button
              key={label}
              onClick={() => onBlurAmountChange(value)}
              className={`editor-choice-pill flex-1 px-2 py-2 text-xs ${
                blurAmount === value ? 'editor-choice-pill--active' : ''
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};
