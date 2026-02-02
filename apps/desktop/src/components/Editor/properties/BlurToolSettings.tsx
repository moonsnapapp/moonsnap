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
        <div className="flex gap-2">
          <button
            onClick={() => onBlurTypeChange('pixelate')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all border ${
              blurType === 'pixelate'
                ? 'bg-[var(--coral-50)] text-[var(--coral-500)] border-[var(--coral-200)]'
                : 'bg-[var(--card)] text-[var(--ink-muted)] border-[var(--polar-frost)] hover:text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]'
            }`}
          >
            <Grid3X3 className="w-3.5 h-3.5" />
            Pixelate
          </button>
          <button
            onClick={() => onBlurTypeChange('gaussian')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-medium transition-all border ${
              blurType === 'gaussian'
                ? 'bg-[var(--coral-50)] text-[var(--coral-500)] border-[var(--coral-200)]'
                : 'bg-[var(--card)] text-[var(--ink-muted)] border-[var(--polar-frost)] hover:text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]'
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
        <div className="flex gap-2">
          {BLUR_INTENSITIES.map(({ label, value }) => (
            <button
              key={label}
              onClick={() => onBlurAmountChange(value)}
              className={`flex-1 h-8 rounded-lg text-xs font-medium transition-all ${
                blurAmount === value
                  ? 'bg-[var(--coral-50)] border border-[var(--coral-300)] text-[var(--coral-500)]'
                  : 'bg-[var(--card)] border border-[var(--polar-frost)] hover:bg-[var(--polar-ice)] text-[var(--ink-muted)]'
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
