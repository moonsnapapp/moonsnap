import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { useLicenseStore } from './licenseStore';

describe('licenseStore', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    useLicenseStore.setState({
      status: 'trial',
      trialDaysLeft: null,
      licensedVersion: null,
      seatsUsed: null,
      seatsLimit: null,
      deviceName: null,
      customerName: null,
      customerEmail: null,
      customerAvatarUrl: null,
      isLoading: false,
    });
  });

  describe('initial state', () => {
    it('should default to trial status', () => {
      const { status } = useLicenseStore.getState();
      expect(status).toBe('trial');
    });
  });

  describe('fetchStatus', () => {
    it('should update state from backend', async () => {
      mockInvoke.mockResolvedValueOnce({
        status: 'pro',
        trialDaysLeft: null,
        licensedVersion: 1,
        seatsUsed: null,
        seatsLimit: 3,
        deviceName: 'DESKTOP-01',
        customerName: 'Taylor Example',
        customerEmail: 'taylor@example.com',
        customerAvatarUrl: 'https://example.com/avatar.png',
      });

      await useLicenseStore.getState().fetchStatus();

      const state = useLicenseStore.getState();
      expect(state.status).toBe('pro');
      expect(state.licensedVersion).toBe(1);
      expect(state.customerName).toBe('Taylor Example');
      expect(state.customerEmail).toBe('taylor@example.com');
      expect(mockInvoke).toHaveBeenCalledWith('get_license_status');
    });

    it('should handle fetch errors gracefully', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      await useLicenseStore.getState().fetchStatus();

      const { status } = useLicenseStore.getState();
      expect(status).toBe('trial');
    });
  });

  describe('activate', () => {
    it('should call backend and refresh status on success', async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true, message: 'Activated' })
        .mockResolvedValueOnce({
          status: 'pro',
          trialDaysLeft: null,
          licensedVersion: 1,
          seatsUsed: null,
          seatsLimit: 3,
          deviceName: 'DESKTOP-01',
          customerName: 'Taylor Example',
          customerEmail: 'taylor@example.com',
          customerAvatarUrl: 'https://example.com/avatar.png',
        });

      const result = await useLicenseStore.getState().activate('test-key');

      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('activate_license', { key: 'test-key' });
    });

    it('should return failure result on error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Invalid key'));

      const result = await useLicenseStore.getState().activate('bad-key');

      expect(result.success).toBe(false);
      expect(result.message).toContain('Invalid key');
    });
  });

  describe('deactivate', () => {
    it('should call backend and refresh status', async () => {
      useLicenseStore.setState({ status: 'pro' });
      mockInvoke
        .mockResolvedValueOnce(undefined) // deactivate_license
        .mockResolvedValueOnce({
          status: 'free',
          trialDaysLeft: null,
          licensedVersion: null,
          seatsUsed: null,
          seatsLimit: null,
          deviceName: null,
          customerName: null,
          customerEmail: null,
          customerAvatarUrl: null,
        });

      await useLicenseStore.getState().deactivate();

      expect(mockInvoke).toHaveBeenCalledWith('deactivate_license');
      expect(useLicenseStore.getState().status).toBe('free');
    });
  });

  describe('isPro', () => {
    it('should return true for pro status', () => {
      useLicenseStore.setState({ status: 'pro' });
      expect(useLicenseStore.getState().isPro()).toBe(true);
    });

    it('should return true for trial status', () => {
      useLicenseStore.setState({ status: 'trial' });
      expect(useLicenseStore.getState().isPro()).toBe(true);
    });

    it('should return false for free status', () => {
      useLicenseStore.setState({ status: 'free' });
      expect(useLicenseStore.getState().isPro()).toBe(false);
    });

    it('should return false for expired status', () => {
      useLicenseStore.setState({ status: 'expired' });
      expect(useLicenseStore.getState().isPro()).toBe(false);
    });
  });
});
