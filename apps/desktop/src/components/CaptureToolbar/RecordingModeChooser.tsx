import { memo, useState } from 'react';
import { Zap, Clapperboard, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';

interface RecordingModeChooserProps {
  onSelect: (action: AfterRecordingAction, remember: boolean) => void;
  onBack: () => void;
}

export const RecordingModeChooser = memo(function RecordingModeChooser({
  onSelect,
  onBack,
}: RecordingModeChooserProps) {
  const [remember, setRemember] = useState(false);
  const [hovered, setHovered] = useState<'quick' | 'studio' | null>(null);

  const btnClass = (mode: 'quick' | 'studio') => cn(
    'flex flex-col items-center gap-2 px-6 py-4 rounded-xl transition-all',
    'hover:bg-white/10',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
    hovered === mode ? 'bg-white/10' : 'bg-white/5',
  );

  return (
    <div className="glass-toolbar glass-toolbar--minimal pointer-events-auto">
      <button
        type="button"
        onClick={onBack}
        className="glass-btn glass-btn--md shrink-0 ml-1"
        title="Back"
      >
        <ArrowLeft size={14} />
      </button>
      <div className="flex flex-col items-center gap-3 px-4 py-3 flex-1">
        <span className="glass-text--muted text-[10px] uppercase tracking-wider select-none">
          Choose recording mode
        </span>

        <div className="flex items-stretch gap-3">
          <button
            type="button"
            className={btnClass('quick')}
            onClick={() => onSelect('save', remember)}
            onMouseEnter={() => setHovered('quick')}
            onMouseLeave={() => setHovered(null)}
          >
            <Zap size={22} className="text-amber-400" />
            <div className="text-center">
              <div className="text-xs font-medium text-white">Quick</div>
              <div className="text-[10px] text-white/50 mt-0.5">Ready-to-share .mp4</div>
            </div>
          </button>

          <button
            type="button"
            className={btnClass('studio')}
            onClick={() => onSelect('preview', remember)}
            onMouseEnter={() => setHovered('studio')}
            onMouseLeave={() => setHovered(null)}
          >
            <Clapperboard size={22} className="text-blue-400" />
            <div className="text-center">
              <div className="text-xs font-medium text-white">Studio</div>
              <div className="text-[10px] text-white/50 mt-0.5">Edit with effects</div>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setRemember((v) => !v)}
          className="flex items-center gap-1.5 cursor-pointer select-none group"
        >
          <div className={cn(
            'w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors',
            remember
              ? 'bg-amber-400 border-amber-400'
              : 'bg-white/10 border-white/25 group-hover:border-white/40',
          )}>
            {remember && (
              <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="black" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span className="text-[9px] text-white/40 group-hover:text-white/60 transition-colors">
            Remember my choice
          </span>
          <span className="text-[9px] text-white/25">
            (can be changed in settings)
          </span>
        </button>
      </div>
    </div>
  );
});
