import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { LicenseInfo, LicenseStatus, ActivationResult } from '../types/generated';

/**
 * Runtime shape of LicenseInfo from Tauri invoke.
 * The generated type uses `bigint` for trialDaysLeft (from Rust i64),
 * but Tauri's JSON serialization sends it as a regular number.
 */
interface LicenseInfoRuntime {
  status: LicenseStatus;
  trialDaysLeft: number | null;
  licensedVersion: number | null;
}

interface LicenseState {
  status: LicenseStatus;
  trialDaysLeft: number | null;
  licensedVersion: number | null;
  isLoading: boolean;

  fetchStatus: () => Promise<void>;
  activate: (key: string) => Promise<ActivationResult>;
  deactivate: () => Promise<void>;
  isPro: () => boolean;
}

export const useLicenseStore = create<LicenseState>()(
  devtools(
    (set, get) => ({
      status: 'trial' as LicenseStatus,
      trialDaysLeft: null,
      licensedVersion: null,
      isLoading: false,

      fetchStatus: async () => {
        set({ isLoading: true });
        try {
          // Invoke returns JSON numbers, not bigint, despite the generated type
          const info = await invoke<LicenseInfoRuntime>('get_license_status');
          set({
            status: info.status,
            trialDaysLeft: info.trialDaysLeft,
            licensedVersion: info.licensedVersion,
            isLoading: false,
          });
        } catch (e) {
          console.error('Failed to fetch license status:', e);
          set({ isLoading: false });
        }
      },

      activate: async (key: string) => {
        set({ isLoading: true });
        try {
          const result = await invoke<ActivationResult>('activate_license', { key });
          if (result.success) {
            await get().fetchStatus();
          }
          set({ isLoading: false });
          return result;
        } catch (e) {
          set({ isLoading: false });
          return { success: false, message: String(e) };
        }
      },

      deactivate: async () => {
        set({ isLoading: true });
        try {
          await invoke('deactivate_license');
          await get().fetchStatus();
        } catch (e) {
          console.error('Failed to deactivate license:', e);
        }
        set({ isLoading: false });
      },

      isPro: () => {
        const { status } = get();
        return status === 'pro' || status === 'trial';
      },
    }),
    { name: 'LicenseStore', enabled: process.env.NODE_ENV === 'development' }
  )
);
