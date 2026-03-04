import React from 'react';
import { Lock } from 'lucide-react';
import { useLicenseStore } from '../stores/licenseStore';

interface ProFeatureProps {
  children: React.ReactNode;
  featureName: string;
}

export function ProFeature({ children, featureName }: ProFeatureProps) {
  const isPro = useLicenseStore((s) => s.isPro());

  if (isPro) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40 select-none">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 rounded-lg backdrop-blur-[2px]">
        <Lock className="w-5 h-5 text-white mb-1.5" />
        <span className="text-xs font-medium text-white">{featureName}</span>
        <button
          className="mt-2 px-3 py-1 text-xs font-medium text-white bg-[var(--coral-500)] hover:bg-[var(--coral-600)] rounded-md transition-colors"
          onClick={() => {
            window.open('https://polar.sh/moonsnap', '_blank');
          }}
        >
          Upgrade to Pro
        </button>
      </div>
    </div>
  );
}
