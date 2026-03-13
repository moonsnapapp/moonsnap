import { memo, useState } from 'react';
import { Zap, Clapperboard, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';

interface RecordingModeChooserProps {
  onSelect: (action: AfterRecordingAction, remember: boolean) => void;
  onBack: () => void;
  minimalChrome?: 'window' | 'floating';
}

export const RecordingModeChooser = memo(function RecordingModeChooser({
  onSelect,
  onBack,
  minimalChrome = 'window',
}: RecordingModeChooserProps) {
  const [remember, setRemember] = useState(false);
  const [hovered, setHovered] = useState<'quick' | 'studio' | null>(null);
  const isFloating = minimalChrome === 'floating';

  const btnClass = (mode: 'quick' | 'studio') => cn(
    'recording-mode-chooser-card',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
    hovered === mode && 'recording-mode-chooser-card--active',
  );

  return (
    <div className={cn(
      'glass-toolbar glass-toolbar--minimal pointer-events-auto',
      isFloating && 'glass-toolbar--minimal-floating recording-mode-chooser-toolbar'
    )}>
      <div className={cn(
        'flex flex-col items-center gap-3 px-4 py-3',
        isFloating ? 'recording-mode-chooser-content' : 'flex-1'
      )}>
        <div className="recording-mode-chooser-header">
          <button
            type="button"
            onClick={onBack}
            className={cn(
              'glass-btn glass-btn--md shrink-0 recording-mode-chooser-back',
              !isFloating && 'ml-1'
            )}
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="recording-mode-chooser-eyebrow glass-text--muted select-none">
            Choose recording mode
          </span>
          <span className="recording-mode-chooser-header-spacer" aria-hidden="true" />
        </div>

        <div className={cn('flex items-stretch gap-3', isFloating && 'recording-mode-chooser-options')}>
          <button
            type="button"
            className={btnClass('quick')}
            onClick={() => onSelect('save', remember)}
            onMouseEnter={() => setHovered('quick')}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="recording-mode-chooser-card-icon recording-mode-chooser-card-icon--quick">
              <Zap size={18} className="text-amber-300" />
            </div>
            <div className="recording-mode-chooser-card-text">
              <div className="recording-mode-chooser-card-title">Quick</div>
              <div className="recording-mode-chooser-card-subtitle">Ready-to-share .mp4</div>
            </div>
          </button>

          <button
            type="button"
            className={btnClass('studio')}
            onClick={() => onSelect('preview', remember)}
            onMouseEnter={() => setHovered('studio')}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="recording-mode-chooser-card-icon recording-mode-chooser-card-icon--studio">
              <Clapperboard size={18} className="text-sky-300" />
            </div>
            <div className="recording-mode-chooser-card-text">
              <div className="recording-mode-chooser-card-title">Studio</div>
              <div className="recording-mode-chooser-card-subtitle">Edit with effects</div>
            </div>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setRemember((v) => !v)}
          className="recording-mode-chooser-remember group"
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
          <div className="recording-mode-chooser-remember-copy">
            <span className="recording-mode-chooser-remember-title">
              Remember my choice
            </span>
            <span className="recording-mode-chooser-remember-subtitle">
              You can change this later in settings.
            </span>
          </div>
        </button>
      </div>
    </div>
  );
});
