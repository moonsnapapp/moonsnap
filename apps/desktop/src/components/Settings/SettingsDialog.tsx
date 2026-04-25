import React, { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  Settings,
  Keyboard,
  Video,
  Camera,
  MessageSquare,
  FileText,
  Key,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { ShortcutsTab } from './ShortcutsTab';
import { GeneralTab } from './GeneralTab';
import { RecordingsTab } from './RecordingsTab';
import { ScreenshotsTab } from './ScreenshotsTab';
import { FeedbackTab } from './FeedbackTab';
import { ChangelogTab } from './ChangelogTab';
import { LicenseTab } from './LicenseTab';
import { useSettingsStore, type SettingsSection } from '@/stores/settingsStore';
import { useCaptureSettingsStore } from '@/stores/captureSettingsStore';
import { useUpdater } from '@/hooks/useUpdater';

interface SidebarItem {
  id: SettingsSection;
  label: string;
  icon: React.ReactNode;
}

const sidebarItems: SidebarItem[] = [
  { id: 'general', label: 'General', icon: <Settings className="w-4 h-4" /> },
  { id: 'shortcuts', label: 'Shortcuts', icon: <Keyboard className="w-4 h-4" /> },
  { id: 'recordings', label: 'Recordings', icon: <Video className="w-4 h-4" /> },
  { id: 'screenshots', label: 'Screenshots', icon: <Camera className="w-4 h-4" /> },
  { id: 'feedback', label: 'Feedback', icon: <MessageSquare className="w-4 h-4" /> },
  { id: 'changelog', label: 'Changelog', icon: <FileText className="w-4 h-4" /> },
  { id: 'license', label: 'License', icon: <Key className="w-4 h-4" /> },
];

function renderTab(section: SettingsSection): React.ReactNode {
  switch (section) {
    case 'general':
      return <GeneralTab />;
    case 'shortcuts':
      return <ShortcutsTab />;
    case 'recordings':
      return <RecordingsTab />;
    case 'screenshots':
      return <ScreenshotsTab />;
    case 'feedback':
      return <FeedbackTab />;
    case 'changelog':
      return <ChangelogTab />;
    case 'license':
      return <LicenseTab />;
  }
}

/**
 * SettingsDialog - In-window modal for application settings.
 *
 * Replaces the dedicated settings webview window. Driven by
 * `settingsModalOpen` and `activeTab` in the settings store.
 */
export const SettingsDialog: React.FC = () => {
  const settingsModalOpen = useSettingsStore((s) => s.settingsModalOpen);
  const activeTab = useSettingsStore((s) => s.activeTab);
  const setActiveTab = useSettingsStore((s) => s.setActiveTab);
  const closeSettingsModal = useSettingsStore((s) => s.closeSettingsModal);
  const saveSettings = useSettingsStore((s) => s.saveSettings);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const isInitialized = useSettingsStore((s) => s.isInitialized);

  const loadCaptureSettings = useCaptureSettingsStore((s) => s.loadSettings);
  const captureSettingsInitialized = useCaptureSettingsStore((s) => s.isInitialized);

  const [appVersion, setAppVersion] = useState('');
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false);
  const updateChannel = useSettingsStore((s) => s.settings.general.updateChannel);
  const {
    available,
    version,
    checkForUpdates,
    downloadAndInstall,
    downloading,
    progress,
    contentLength,
    statusMessage,
    error: updateError,
  } = useUpdater(false, updateChannel);

  const downloadPercent = contentLength > 0
    ? Math.min(Math.round((progress / contentLength) * 100), 100)
    : 0;

  useEffect(() => {
    getVersion().then(setAppVersion).catch(() => {});
  }, []);

  // Lazy-load settings only when the dialog first opens.
  useEffect(() => {
    if (!settingsModalOpen) return;
    if (!isInitialized) loadSettings();
    if (!captureSettingsInitialized) loadCaptureSettings();
  }, [
    settingsModalOpen,
    isInitialized,
    loadSettings,
    captureSettingsInitialized,
    loadCaptureSettings,
  ]);

  const handleOpenChange = async (open: boolean) => {
    if (open) return;
    await saveSettings();
    closeSettingsModal();
  };

  const handleCheckUpdates = async () => {
    setIsCheckingUpdates(true);
    try {
      await checkForUpdates(true);
    } finally {
      setIsCheckingUpdates(false);
    }
  };

  const activeLabel = sidebarItems.find((item) => item.id === activeTab)?.label ?? 'Settings';

  return (
    <Dialog open={settingsModalOpen} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[min(960px,92vw)] max-w-[960px] h-[min(720px,86vh)] p-0 gap-0 overflow-hidden flex flex-col"
        hideCloseButton
      >
        {/* Header bar */}
        <div className="h-11 shrink-0 flex items-center justify-between gap-3 border-b border-(--polar-frost) bg-(--polar-ice) pl-4 pr-2">
          <div className="flex items-center gap-2 min-w-0">
            <Settings className="w-4 h-4 text-(--ink-muted) shrink-0" />
            <DialogTitle className="text-sm font-semibold tracking-tight text-(--ink-black) truncate">
              Settings
            </DialogTitle>
            <span className="text-(--ink-muted) text-sm shrink-0">/</span>
            <span className="text-sm text-(--ink-muted) truncate">{activeLabel}</span>
          </div>
          <button
            type="button"
            onClick={() => handleOpenChange(false)}
            aria-label="Close settings"
            className="w-7 h-7 flex items-center justify-center rounded-md text-(--ink-muted) hover:bg-(--polar-frost) hover:text-(--ink-black) transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <div className="w-48 shrink-0 border-r border-(--polar-frost) bg-(--polar-ice) p-2 flex flex-col">
            <div className="flex flex-col gap-1 flex-1">
              {sidebarItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`editor-choice-pill flex items-center gap-3 px-3 py-2 text-sm w-full text-left ${
                    activeTab === item.id ? 'editor-choice-pill--active' : ''
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-h-0 overflow-y-auto p-5">{renderTab(activeTab)}</div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-(--polar-frost) bg-(--polar-ice) px-4 py-2.5 flex items-center gap-3">
          <span className="text-xs text-(--ink-muted) shrink-0">
            MoonSnap{appVersion ? ` v${appVersion}` : ''}
          </span>
          <div className="flex-1 min-w-0">
            {downloading ? (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-(--polar-mist) rounded-full overflow-hidden">
                  <div
                    className="h-full bg-(--coral-400) transition-[width] duration-300 ease-out"
                    style={{ width: `${downloadPercent}%` }}
                  />
                </div>
                <span className="text-xs text-(--ink-muted) tabular-nums shrink-0">
                  {downloadPercent}%
                </span>
              </div>
            ) : isCheckingUpdates ? (
              <span className="text-xs text-(--ink-muted) truncate">Checking for updates…</span>
            ) : statusMessage ? (
              <span
                className={`text-xs truncate ${updateError ? 'text-rose-500' : 'text-(--ink-muted)'}`}
              >
                {statusMessage}
              </span>
            ) : null}
          </div>
          {available ? (
            <button
              onClick={downloadAndInstall}
              disabled={downloading}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50 shrink-0"
            >
              {downloading ? 'Installing…' : `Update to v${version}`}
            </button>
          ) : (
            <button
              onClick={handleCheckUpdates}
              disabled={isCheckingUpdates}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-(--polar-frost) bg-(--card) text-(--ink-dark) hover:bg-(--polar-frost)/50 transition-colors disabled:opacity-50 shrink-0"
            >
              {isCheckingUpdates ? 'Checking…' : 'Check for Updates'}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
