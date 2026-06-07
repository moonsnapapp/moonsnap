import { memo, useState } from 'react';
import { Zap, Clapperboard, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AfterRecordingAction } from '@/stores/captureSettingsStore';

interface RecordingModeChooserProps {
  onSelect: (action: AfterRecordingAction, remember: boolean) => void;
  onBack: () => void;
  minimalChrome?: 'window' | 'floating';
}

type RecordingModeOptionId = 'quick' | 'studio';

const RECORDING_MODE_OPTIONS: Array<{
  id: RecordingModeOptionId;
  action: AfterRecordingAction;
  title: string;
  subtitle: string;
  iconClassName: string;
  icon: typeof Zap;
  iconColorClassName: string;
}> = [
  {
    id: 'quick',
    action: 'save',
    title: 'Quick',
    subtitle: 'Ready to share',
    iconClassName: 'recording-mode-chooser-card-icon--quick',
    icon: Zap,
    iconColorClassName: 'text-amber-300',
  },
  {
    id: 'studio',
    action: 'preview',
    title: 'Studio',
    subtitle: 'Edit with effects',
    iconClassName: 'recording-mode-chooser-card-icon--studio',
    icon: Clapperboard,
    iconColorClassName: 'text-sky-300',
  },
];

function getRecordingModeCardClassName(
  mode: RecordingModeOptionId,
  hovered: RecordingModeOptionId | null
) {
  return cn(
    'recording-mode-chooser-card',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/30',
    hovered === mode && 'recording-mode-chooser-card--active',
  );
}

function RecordingModeOptionButton({
  option,
  remember,
  hovered,
  onSelect,
  onHover,
}: {
  option: typeof RECORDING_MODE_OPTIONS[number];
  remember: boolean;
  hovered: RecordingModeOptionId | null;
  onSelect: (action: AfterRecordingAction, remember: boolean) => void;
  onHover: (mode: RecordingModeOptionId | null) => void;
}) {
  const Icon = option.icon;

  return (
    <button
      type="button"
      className={getRecordingModeCardClassName(option.id, hovered)}
      onClick={() => onSelect(option.action, remember)}
      onMouseEnter={() => onHover(option.id)}
      onMouseLeave={() => onHover(null)}
    >
      <div className={cn('recording-mode-chooser-card-icon', option.iconClassName)}>
        <Icon size={18} className={option.iconColorClassName} />
      </div>
      <div className="recording-mode-chooser-card-text">
        <div className="recording-mode-chooser-card-title">{option.title}</div>
        <div className="recording-mode-chooser-card-subtitle">{option.subtitle}</div>
      </div>
    </button>
  );
}

function RememberChoiceButton({
  remember,
  onToggle,
}: {
  remember: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
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
  );
}

function isFloatingChrome(minimalChrome: RecordingModeChooserProps['minimalChrome']) {
  return minimalChrome === 'floating';
}

function getChooserToolbarClassName(isFloating: boolean) {
  return cn(
    'glass-toolbar glass-toolbar--minimal pointer-events-auto',
    isFloating && 'glass-toolbar--minimal-floating recording-mode-chooser-toolbar'
  );
}

function getChooserContentClassName(isFloating: boolean) {
  return cn(
    'flex flex-col items-center gap-3 px-4 py-3',
    isFloating ? 'recording-mode-chooser-content' : 'flex-1'
  );
}

function getChooserBackButtonClassName(isFloating: boolean) {
  return cn(
    'glass-btn glass-btn--md shrink-0 recording-mode-chooser-back',
    !isFloating && 'ml-1'
  );
}

function getChooserOptionsClassName(isFloating: boolean) {
  return cn('flex items-stretch gap-3', isFloating && 'recording-mode-chooser-options');
}

export const RecordingModeChooser = memo(function RecordingModeChooser({
  onSelect,
  onBack,
  minimalChrome = 'window',
}: RecordingModeChooserProps) {
  const [remember, setRemember] = useState(false);
  const [hovered, setHovered] = useState<'quick' | 'studio' | null>(null);
  const isFloating = isFloatingChrome(minimalChrome);

  return (
    <div className={getChooserToolbarClassName(isFloating)}>
      <div className={getChooserContentClassName(isFloating)}>
        <div className="recording-mode-chooser-header">
          <button
            type="button"
            onClick={onBack}
            className={getChooserBackButtonClassName(isFloating)}
            title="Back"
          >
            <ArrowLeft size={14} />
          </button>
          <span className="recording-mode-chooser-eyebrow glass-text--muted select-none">
            Choose recording mode
          </span>
          <span className="recording-mode-chooser-header-spacer" aria-hidden="true" />
        </div>

        <div className={getChooserOptionsClassName(isFloating)}>
          {RECORDING_MODE_OPTIONS.map((option) => (
            <RecordingModeOptionButton
              key={option.id}
              option={option}
              remember={remember}
              hovered={hovered}
              onSelect={onSelect}
              onHover={setHovered}
            />
          ))}
        </div>

        <RememberChoiceButton
          remember={remember}
          onToggle={() => setRemember((value) => !value)}
        />
      </div>
    </div>
  );
});
