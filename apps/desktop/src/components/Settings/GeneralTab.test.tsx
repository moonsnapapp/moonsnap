import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { GeneralTab } from './GeneralTab';
import { useSettingsStore } from '@/stores/settingsStore';
import { mockEmit, setInvokeResponse } from '@/test/mocks/tauri';

describe('GeneralTab', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settings: {
        shortcuts: {},
        general: {
          startWithWindows: false,
          minimizeToTray: true,
          showNotifications: true,
          defaultSaveDir: 'C:\\Users\\walter\\Videos',
          imageFormat: 'png',
          jpgQuality: 85,
          allowOverride: false,
          theme: 'light',
        },
      },
    });

    setInvokeResponse('is_autostart_enabled', false);
    setInvokeResponse('get_default_save_dir', 'C:\\Users\\walter\\Videos');
  });

  it('emits a theme sync event when changing the theme', async () => {
    const saveSettings = vi.fn(async () => undefined);
    useSettingsStore.setState({ saveSettings });

    render(<GeneralTab />);

    fireEvent.click(screen.getByRole('button', { name: 'Dark' }));

    expect(useSettingsStore.getState().settings.general.theme).toBe('dark');
    // Called twice: once from useTheme.setTheme, once from auto-persist in updateGeneralSettings
    expect(saveSettings).toHaveBeenCalledTimes(2);

    await waitFor(() => {
      expect(mockEmit).toHaveBeenCalledWith('theme-changed', { theme: 'dark' });
    });
  });
});
