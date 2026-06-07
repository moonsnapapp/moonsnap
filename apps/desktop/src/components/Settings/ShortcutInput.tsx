import React, { useState, useEffect, useCallback } from 'react';
import { RotateCcw, ChevronDown, Check, AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { hotkeyLogger } from '@/utils/logger';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { checkShortcutConflict } from '@/utils/hotkeyManager';
import type { ShortcutStatus } from '@/types';

interface ShortcutInputProps {
  value: string;
  onChange: (shortcut: string) => void;
  onReset?: () => void;
  status?: ShortcutStatus;
  disabled?: boolean;
  showReset?: boolean;
  defaultValue?: string;
  shortcutId?: string; // Used to exclude self from internal conflict check
}

type ConflictStatus = 'unchecked' | 'checking' | 'available' | 'conflict' | 'internal_conflict';
type ShortcutModifier = 'Ctrl' | 'Shift' | 'Alt';
type ConflictStatusIndicatorKind = 'checking' | 'available' | 'conflict';

// Available keys for the dropdown
const KEY_GROUPS = {
  special: [
    { value: 'PrintScreen', label: 'Print Screen' },
  ],
  letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(k => ({ value: k, label: k })),
  numbers: '0123456789'.split('').map(k => ({ value: k, label: k })),
  functionKeys: Array.from({ length: 12 }, (_, i) => ({ value: `F${i + 1}`, label: `F${i + 1}` })),
  navigation: [
    { value: 'Space', label: 'Space' },
    { value: 'Enter', label: 'Enter' },
    { value: 'Tab', label: 'Tab' },
    { value: 'Escape', label: 'Escape' },
    { value: 'Backspace', label: 'Backspace' },
    { value: 'Delete', label: 'Delete' },
    { value: 'Insert', label: 'Insert' },
    { value: 'Home', label: 'Home' },
    { value: 'End', label: 'End' },
    { value: 'PageUp', label: 'Page Up' },
    { value: 'PageDown', label: 'Page Down' },
  ],
  arrows: [
    { value: 'ArrowUp', label: 'Up' },
    { value: 'ArrowDown', label: 'Down' },
    { value: 'ArrowLeft', label: 'Left' },
    { value: 'ArrowRight', label: 'Right' },
  ],
};

// Flat list for label lookup
const ALL_KEYS = [
  ...KEY_GROUPS.special,
  ...KEY_GROUPS.letters,
  ...KEY_GROUPS.numbers,
  ...KEY_GROUPS.functionKeys,
  ...KEY_GROUPS.navigation,
  ...KEY_GROUPS.arrows,
];

const KEY_GROUP_SECTIONS = [
  { label: 'Special', options: KEY_GROUPS.special },
  { label: 'Letters', options: KEY_GROUPS.letters },
  { label: 'Numbers', options: KEY_GROUPS.numbers },
  { label: 'Function Keys', options: KEY_GROUPS.functionKeys },
  { label: 'Navigation', options: KEY_GROUPS.navigation },
  { label: 'Arrows', options: KEY_GROUPS.arrows },
];

const PENDING_SHORTCUT_BORDER_CLASSES: Partial<Record<ConflictStatus, string>> = {
  internal_conflict: 'border-red-500/70',
  checking: 'border-[var(--accent-400)]/50',
};

const SAVED_SHORTCUT_BORDER_CLASSES: Partial<Record<ShortcutStatus, string>> = {
  registered: 'border-emerald-500/50',
  conflict: 'border-red-500/50',
  error: 'border-red-500/50',
};

const CONFLICT_STATUS_INDICATOR_KINDS: Partial<Record<ConflictStatus, ConflictStatusIndicatorKind>> = {
  checking: 'checking',
  conflict: 'conflict',
  internal_conflict: 'conflict',
};

const CONFLICT_STATUS_MESSAGE_PROPS: Partial<
  Record<
    ConflictStatus,
    {
      className: string;
      icon: React.ComponentType<{ className?: string }>;
      text: string;
    }
  >
> = {
  conflict: {
    className: 'text-xs text-red-500 flex items-center gap-1',
    icon: AlertTriangle,
    text: 'Shortcut is unavailable right now.',
  },
  internal_conflict: {
    className: 'text-xs text-red-500 flex items-center gap-1',
    icon: AlertTriangle,
    text: 'This shortcut is already used by another MoonSnap action',
  },
  available: {
    className: 'text-xs text-emerald-500 flex items-center gap-1',
    icon: Check,
    text: 'Shortcut is available',
  },
};

// Parse shortcut string into components
function parseShortcut(shortcut: string): { ctrl: boolean; shift: boolean; alt: boolean; key: string } {
  if (!shortcut) return { ctrl: false, shift: false, alt: false, key: '' };
  
  const parts = shortcut.split('+').map(p => p.trim());
  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1).map(m => m.toLowerCase());
  
  return {
    ctrl: modifiers.some(m => m === 'ctrl' || m === 'control' || m === 'commandorcontrol'),
    shift: modifiers.includes('shift'),
    alt: modifiers.includes('alt'),
    key: key || '',
  };
}

// Build shortcut string from components
function buildShortcut(ctrl: boolean, shift: boolean, alt: boolean, key: string): string {
  const modifiers: Array<[boolean, ShortcutModifier]> = [
    [ctrl, 'Ctrl'],
    [shift, 'Shift'],
    [alt, 'Alt'],
  ];
  const shortcutParts = modifiers
    .filter(([isEnabled]) => isEnabled)
    .map(([, modifier]) => modifier);

  return key ? [...shortcutParts, key].join('+') : '';
}

// Get display label for a key value
function getKeyLabel(key: string): string {
  const option = ALL_KEYS.find(o => o.value === key);
  return option?.label || key || 'None';
}

function getPendingShortcutBorderClass(conflictStatus: ConflictStatus): string {
  return PENDING_SHORTCUT_BORDER_CLASSES[conflictStatus] ?? 'border-[var(--accent-400)]/70';
}

function getSavedShortcutBorderClass(status: ShortcutStatus): string {
  return SAVED_SHORTCUT_BORDER_CLASSES[status] ?? 'border-[var(--polar-frost)]';
}

function getShortcutBorderClass(
  hasPendingChanges: boolean,
  conflictStatus: ConflictStatus,
  status: ShortcutStatus
) {
  return hasPendingChanges
    ? getPendingShortcutBorderClass(conflictStatus)
    : getSavedShortcutBorderClass(status);
}

interface KeyGroupSectionProps {
  label: string;
  options: Array<{ value: string; label: string }>;
}

function KeyGroupSection({ label, options }: KeyGroupSectionProps) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-[var(--accent-400)]">{label}</DropdownMenuLabel>
      {options.map(opt => (
        <DropdownMenuRadioItem key={opt.value} value={opt.value} className="text-xs">
          {opt.label}
        </DropdownMenuRadioItem>
      ))}
    </>
  );
}

interface ConflictStatusIndicatorProps {
  conflictStatus: ConflictStatus;
  hasPendingChanges: boolean;
}

function getConflictStatusIndicatorKind({
  conflictStatus,
  hasPendingChanges,
}: ConflictStatusIndicatorProps) {
  return CONFLICT_STATUS_INDICATOR_KINDS[conflictStatus]
    ?? (conflictStatus === 'available' && hasPendingChanges ? 'available' : null);
}

function ConflictStatusIndicator({
  conflictStatus,
  hasPendingChanges,
}: ConflictStatusIndicatorProps) {
  const indicatorKind = getConflictStatusIndicatorKind({ conflictStatus, hasPendingChanges });

  if (indicatorKind === 'checking') {
    return <Loader2 className="ml-1 h-4 w-4 animate-spin text-[var(--accent-400)]" />;
  }

  if (indicatorKind === 'available') {
    return <Check className="ml-1 h-4 w-4 text-emerald-500" />;
  }

  if (indicatorKind === 'conflict') {
    return <AlertTriangle className="ml-1 h-4 w-4 text-red-500" />;
  }

  return null;
}

function ConflictStatusMessage({
  conflictStatus,
  hasPendingChanges,
}: ConflictStatusIndicatorProps) {
  const messageProps = conflictStatus === 'available' && !hasPendingChanges
    ? undefined
    : CONFLICT_STATUS_MESSAGE_PROPS[conflictStatus];

  if (!messageProps) return null;

  const Icon = messageProps.icon;

  return (
    <p className={messageProps.className}>
      <Icon className="w-3 h-3" />
      {messageProps.text}
    </p>
  );
}

function ShortcutModifierCheckbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex shrink-0 items-center gap-1 cursor-pointer select-none whitespace-nowrap">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className={cn(
          'h-4 w-4 rounded border cursor-pointer appearance-none',
          'border-[var(--polar-frost)] bg-[var(--polar-ice)]',
          'checked:bg-[var(--accent-400)] checked:border-[var(--accent-400)]',
          'focus:ring-2 focus:ring-[var(--accent-400)]/30 focus:ring-offset-0',
          'relative',
          'checked:after:content-["âœ“"] checked:after:absolute checked:after:inset-0',
          'checked:after:flex checked:after:items-center checked:after:justify-center',
          'checked:after:text-[10px] checked:after:text-white checked:after:font-bold'
        )}
      />
      <span className="text-xs text-[var(--ink-dark)]">{label}</span>
    </label>
  );
}

function ShortcutModifierControls({
  localCtrl,
  localShift,
  localAlt,
  disabled,
  setLocalCtrl,
  setLocalShift,
  setLocalAlt,
}: {
  localCtrl: boolean;
  localShift: boolean;
  localAlt: boolean;
  disabled: boolean;
  setLocalCtrl: (value: boolean) => void;
  setLocalShift: (value: boolean) => void;
  setLocalAlt: (value: boolean) => void;
}) {
  return (
    <>
      <ShortcutModifierCheckbox
        label="Ctrl"
        checked={localCtrl}
        disabled={disabled}
        onChange={setLocalCtrl}
      />
      <span className="shrink-0 px-0.5 text-xs text-[var(--ink-muted)]">+</span>
      <ShortcutModifierCheckbox
        label="Shift"
        checked={localShift}
        disabled={disabled}
        onChange={setLocalShift}
      />
      <span className="shrink-0 px-0.5 text-xs text-[var(--ink-muted)]">+</span>
      <ShortcutModifierCheckbox
        label="Alt"
        checked={localAlt}
        disabled={disabled}
        onChange={setLocalAlt}
      />
      <span className="shrink-0 px-0.5 text-xs text-[var(--ink-muted)]">+</span>
    </>
  );
}

function ShortcutKeyDropdown({
  localKey,
  disabled,
  onKeyChange,
}: {
  localKey: string;
  disabled: boolean;
  onKeyChange: (newKey: string) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          className={cn(
            'flex h-7 max-w-full shrink items-center justify-between gap-1.5 px-2 min-w-[76px]',
            'rounded-lg border text-xs',
            'bg-[var(--polar-ice)] border-[var(--polar-frost)]',
            'hover:bg-[var(--polar-mist)] hover:border-[var(--ink-subtle)]',
            'focus:outline-none focus:ring-2 focus:ring-[var(--accent-400)]/30',
            disabled && 'pointer-events-none opacity-50'
          )}
        >
          <span className="text-xs leading-tight text-[var(--ink-black)]">{getKeyLabel(localKey)}</span>
          <ChevronDown className="w-3 h-3 text-[var(--ink-muted)]" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="p-0 bg-[var(--card)] border-[var(--polar-frost)]"
        align="start"
      >
        <ScrollArea className="h-[300px]">
          <div className="p-1">
            <DropdownMenuRadioGroup value={localKey || 'none'} onValueChange={onKeyChange}>
              <DropdownMenuRadioItem value="none" className="text-xs text-[var(--ink-muted)]">
                None
              </DropdownMenuRadioItem>
              {KEY_GROUP_SECTIONS.map((section) => (
                <KeyGroupSection
                  key={section.label}
                  label={section.label}
                  options={section.options}
                />
              ))}
            </DropdownMenuRadioGroup>
          </div>
        </ScrollArea>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function canApplyShortcut(
  hasPendingChanges: boolean,
  conflictStatus: ConflictStatus
) {
  return hasPendingChanges && conflictStatus !== 'internal_conflict' && conflictStatus !== 'checking';
}

function canResetShortcut({
  showReset,
  isModifiedFromDefault,
  hasPendingChanges,
}: Pick<
  React.ComponentProps<typeof ShortcutActionButtons>,
  'showReset' | 'isModifiedFromDefault' | 'hasPendingChanges'
>) {
  return showReset && isModifiedFromDefault && !hasPendingChanges;
}

function shouldSkipConflictCheck(localShortcut: string, value: string) {
  return !localShortcut || localShortcut === value;
}

function normalizeConflictStatus(result: Awaited<ReturnType<typeof checkShortcutConflict>>): ConflictStatus {
  return result === 'error' ? 'conflict' : result;
}

function ShortcutApplyButton({
  isValid,
  disabled,
  onApply,
}: Pick<React.ComponentProps<typeof ShortcutActionButtons>, 'isValid' | 'disabled' | 'onApply'>) {
  return (
    <Button
      variant="default"
      size="sm"
      onClick={onApply}
      disabled={disabled || !isValid}
      className="ml-1 h-7 px-2 text-xs bg-[var(--accent-400)] text-white hover:bg-[var(--accent-500)]"
      title="Apply shortcut"
    >
      <Check className="mr-1 h-3 w-3" />
      Apply
    </Button>
  );
}

function ShortcutResetButton({
  disabled,
  onReset,
}: Pick<React.ComponentProps<typeof ShortcutActionButtons>, 'disabled' | 'onReset'>) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onReset}
      disabled={disabled}
      className="ml-1 h-7 w-7 text-[var(--ink-muted)] hover:text-[var(--ink-black)]"
      title="Reset to default"
    >
      <RotateCcw className="w-3 h-3" />
    </Button>
  );
}

function ShortcutActionButtons({
  hasPendingChanges,
  conflictStatus,
  isValid,
  disabled,
  showReset,
  isModifiedFromDefault,
  onApply,
  onReset,
}: {
  hasPendingChanges: boolean;
  conflictStatus: ConflictStatus;
  isValid: boolean;
  disabled: boolean;
  showReset: boolean;
  isModifiedFromDefault: boolean;
  onApply: () => void;
  onReset?: () => void;
}) {
  if (canApplyShortcut(hasPendingChanges, conflictStatus)) {
    return <ShortcutApplyButton isValid={isValid} disabled={disabled} onApply={onApply} />;
  }

  if (canResetShortcut({ showReset, isModifiedFromDefault, hasPendingChanges })) {
    return <ShortcutResetButton disabled={disabled} onReset={onReset} />;
  }

  return null;
}

function useShortcutInputState({
  value,
  status,
  disabled,
  shortcutId,
  onChange,
}: {
  value: string;
  status: ShortcutStatus;
  disabled: boolean;
  shortcutId?: string;
  onChange: (shortcut: string) => void;
}) {
  const [localCtrl, setLocalCtrl] = useState(false);
  const [localShift, setLocalShift] = useState(false);
  const [localAlt, setLocalAlt] = useState(false);
  const [localKey, setLocalKey] = useState('');
  const [conflictStatus, setConflictStatus] = useState<ConflictStatus>('unchecked');

  useEffect(() => {
    const parsed = parseShortcut(value);
    setLocalCtrl(parsed.ctrl);
    setLocalShift(parsed.shift);
    setLocalAlt(parsed.alt);
    setLocalKey(parsed.key);
    setConflictStatus('unchecked');
  }, [value]);

  useEffect(() => {
    if (status === 'registered') {
      setConflictStatus('unchecked');
    }
  }, [status]);

  const localShortcut = buildShortcut(localCtrl, localShift, localAlt, localKey);
  const hasPendingChanges = localShortcut !== value && localShortcut !== '';
  const isValid = localKey !== '';

  const checkConflicts = useCallback(async () => {
    if (shouldSkipConflictCheck(localShortcut, value)) {
      setConflictStatus('unchecked');
      return;
    }

    setConflictStatus('checking');

    try {
      const result = await checkShortcutConflict(localShortcut, shortcutId);
      setConflictStatus(normalizeConflictStatus(result));
    } catch (error) {
      hotkeyLogger.error('Error checking conflict:', error);
      setConflictStatus('conflict');
    }
  }, [localShortcut, value, shortcutId]);

  useEffect(() => {
    if (!hasPendingChanges) {
      setConflictStatus('unchecked');
      return;
    }

    const timer = setTimeout(() => {
      checkConflicts();
    }, 300);

    return () => clearTimeout(timer);
  }, [hasPendingChanges, checkConflicts]);

  const handleApply = () => {
    if (disabled || !isValid) return;
    onChange(localShortcut);
  };

  const handleKeyChange = (newKey: string) => {
    if (disabled) return;
    setLocalKey(newKey === 'none' ? '' : newKey);
  };

  return {
    localCtrl,
    localShift,
    localAlt,
    localKey,
    localShortcut,
    conflictStatus,
    hasPendingChanges,
    isValid,
    setLocalCtrl,
    setLocalShift,
    setLocalAlt,
    handleApply,
    handleKeyChange,
  };
}

export const ShortcutInput: React.FC<ShortcutInputProps> = ({
  value,
  onChange,
  onReset,
  status = 'pending',
  disabled = false,
  showReset = true,
  defaultValue,
  shortcutId,
}) => {
  const {
    localCtrl,
    localShift,
    localAlt,
    localKey,
    conflictStatus,
    hasPendingChanges,
    isValid,
    setLocalCtrl,
    setLocalShift,
    setLocalAlt,
    handleApply,
    handleKeyChange,
  } = useShortcutInputState({
    value,
    status,
    disabled,
    shortcutId,
    onChange,
  });

  const isModifiedFromDefault = defaultValue && value !== defaultValue;
  const borderClass = getShortcutBorderClass(hasPendingChanges, conflictStatus, status);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 p-1.5 rounded-lg border transition-colors',
          'bg-[var(--card)]',
          borderClass,
          disabled && 'opacity-50'
        )}
      >
        <ShortcutModifierControls
          localCtrl={localCtrl}
          localShift={localShift}
          localAlt={localAlt}
          disabled={disabled}
          setLocalCtrl={setLocalCtrl}
          setLocalShift={setLocalShift}
          setLocalAlt={setLocalAlt}
        />

        <ShortcutKeyDropdown
          localKey={localKey}
          disabled={disabled}
          onKeyChange={handleKeyChange}
        />
        
        <ConflictStatusIndicator
          conflictStatus={conflictStatus}
          hasPendingChanges={hasPendingChanges}
        />

        <ShortcutActionButtons
          hasPendingChanges={hasPendingChanges}
          conflictStatus={conflictStatus}
          isValid={isValid}
          disabled={disabled}
          showReset={showReset}
          isModifiedFromDefault={Boolean(isModifiedFromDefault)}
          onApply={handleApply}
          onReset={onReset}
        />
      </div>

      <ConflictStatusMessage
        conflictStatus={conflictStatus}
        hasPendingChanges={hasPendingChanges}
      />
    </div>
  );
};
