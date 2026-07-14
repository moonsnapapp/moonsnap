import React, { useCallback } from 'react';
import { Scan, Monitor, ScreenShare, Check, AlertTriangle, Video, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShortcutInput } from './ShortcutInput';
import { useSettingsStore, useShortcutsList } from '@/stores/settingsStore';
import { updateShortcut, hasInternalConflict } from '@/utils/hotkeyManager';
import type { ShortcutConfig } from '@/types';

const SHORTCUT_ICONS: Record<string, React.ReactNode> = {
  open_capture_toolbar: <Scan className="w-5 h-5" />,
  new_capture: <Scan className="w-5 h-5" />,
  fullscreen_capture: <Monitor className="w-5 h-5" />,
  all_monitors_capture: <ScreenShare className="w-5 h-5" />,
  record_video: <Video className="w-5 h-5" />,
  record_gif: <Film className="w-5 h-5" />,
};

interface ShortcutItemProps {
  config: ShortcutConfig;
}

function ShortcutIcon({ shortcutId }: { shortcutId: string }) {
  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-[var(--polar-frost)] bg-[var(--card)] text-[var(--accent-400)] shadow-sm">
      {SHORTCUT_ICONS[shortcutId] || <Scan className="w-5 h-5" />}
    </div>
  );
}

function ShortcutStatusIcon({ config }: { config: ShortcutConfig }) {
  if (config.status === 'registered') {
    return <Check className="w-4 h-4 text-emerald-500" />;
  }

  if (config.status !== 'conflict') {
    return null;
  }

  const message = config.statusMessage ?? 'Shortcut could not be registered';
  return (
    <span title={message} aria-label={message}>
      <AlertTriangle className="w-4 h-4 text-amber-500" />
    </span>
  );
}

function ShortcutStatusMessage({ config }: { config: ShortcutConfig }) {
  if (config.status !== 'conflict' || !config.statusMessage) {
    return null;
  }

  return <p className="mb-2 text-xs text-amber-700">{config.statusMessage}</p>;
}

const ShortcutItem: React.FC<ShortcutItemProps> = ({ config }) => {
  const { resetShortcut } = useSettingsStore();

  const handleShortcutChange = useCallback(async (newShortcut: string) => {
    if (hasInternalConflict(newShortcut, config.id)) return;
    await updateShortcut(config.id, newShortcut);
  }, [config.id]);

  const handleReset = useCallback(() => {
    resetShortcut(config.id);
    updateShortcut(config.id, config.defaultShortcut);
  }, [config.id, config.defaultShortcut, resetShortcut]);

  return (
    <div className="relative rounded-lg border border-[var(--polar-frost)] bg-[var(--polar-ice)] p-3">
      <div className="absolute right-3 top-3">
        <ShortcutIcon shortcutId={config.id} />
      </div>

      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-2 pr-12">
          <h4 className="text-sm font-medium text-[var(--ink-black)]">{config.name}</h4>
          <ShortcutStatusIcon config={config} />
        </div>
        <p className="mb-2 pr-12 text-xs text-[var(--ink-muted)]">{config.description}</p>
        <ShortcutStatusMessage config={config} />

        <ShortcutInput
          value={config.currentShortcut}
          onChange={handleShortcutChange}
          onReset={handleReset}
          status={config.status}
          defaultValue={config.defaultShortcut}
          shortcutId={config.id}
        />
      </div>
    </div>
  );
};

export const ShortcutsTab: React.FC = () => {
  const shortcuts = useShortcutsList();
  const { resetAllShortcuts } = useSettingsStore();

  const handleResetAll = useCallback(async () => {
    resetAllShortcuts();
    for (const config of shortcuts) {
      await updateShortcut(config.id, config.defaultShortcut);
    }
  }, [resetAllShortcuts, shortcuts]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        {shortcuts.map((config) => (
          <ShortcutItem key={config.id} config={config} />
        ))}
      </div>

      <div className="pt-4 border-t border-[var(--polar-frost)]">
        <Button
          variant="outline"
          size="sm"
          onClick={handleResetAll}
          className="text-xs bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-muted)] hover:text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
        >
          Reset All to Defaults
        </Button>
      </div>
    </div>
  );
};
