import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockUseLicenseStore = vi.fn();

vi.mock('@/stores/licenseStore', () => ({
  useLicenseStore: () => mockUseLicenseStore(),
}));

import { LicenseTab } from './LicenseTab';

describe('LicenseTab', () => {
  beforeEach(() => {
    mockUseLicenseStore.mockReturnValue({
      status: 'pro',
      trialDaysLeft: null,
      seatsLimit: 2,
      deviceName: 'DESKTOP-9V6CAA5',
      customerName: 'w',
      customerEmail: 'walterlow88@gmail.com',
      customerAvatarUrl: null,
      isLoading: false,
      fetchStatus: vi.fn(),
      activate: vi.fn(),
      deactivate: vi.fn().mockResolvedValue({ success: true, message: 'License deactivated successfully' }),
    });
  });

  it('renders pro metadata and prefers email over a one-character public name', () => {
    render(<LicenseTab />);

    expect(screen.getAllByText('walterlow88@gmail.com').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^w$/)).not.toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByText('DESKTOP-9V6CAA5')).toBeInTheDocument();
    expect(screen.getByText('Device limit')).toBeInTheDocument();
    expect(screen.getByText('2 devices')).toBeInTheDocument();
  });
});
