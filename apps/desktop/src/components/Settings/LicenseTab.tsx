import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, Clock, ExternalLink, Mail, Monitor } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLicenseStore } from '@/stores/licenseStore';
import type { LicenseStatus } from '@/types/generated';

const STATUS_CONFIG: Record<LicenseStatus, { icon: React.ReactNode; label: string; description: string }> = {
  pro: {
    icon: <CheckCircle className="w-5 h-5 text-emerald-500" />,
    label: 'MoonSnap Pro',
    description: 'You have full access to all features.',
  },
  trial: {
    icon: <Clock className="w-5 h-5 text-[var(--coral-400)]" />,
    label: 'Free Trial',
    description: 'You have access to all Pro features during your trial.',
  },
  free: {
    icon: <AlertCircle className="w-5 h-5 text-[var(--ink-muted)]" />,
    label: 'Free',
    description: 'Your trial has ended. Upgrade to unlock Pro features.',
  },
  expired: {
    icon: <AlertCircle className="w-5 h-5 text-amber-500" />,
    label: 'Expired',
    description: 'Your license has expired. Please renew to restore Pro features.',
  },
};

export const LicenseTab: React.FC = () => {
  const {
    status,
    trialDaysLeft,
    seatsLimit,
    deviceName,
    customerName,
    customerEmail,
    customerAvatarUrl,
    isLoading,
    fetchStatus,
    activate,
    deactivate,
  } = useLicenseStore();
  const [licenseKey, setLicenseKey] = useState('');
  const [activationMessage, setActivationMessage] = useState<{ text: string; success: boolean } | null>(null);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleActivate = async () => {
    if (!licenseKey.trim()) return;
    setActivationMessage(null);
    const result = await activate(licenseKey.trim());
    setActivationMessage({ text: result.message, success: result.success });
    if (result.success) {
      setLicenseKey('');
    }
  };

  const handleDeactivate = async () => {
    setActivationMessage(null);
    const result = await deactivate();
    setActivationMessage({ text: result.message, success: result.success });
  };

  const statusConfig = STATUS_CONFIG[status];
  const ownerLabel =
    customerName && customerName.trim().length > 1
      ? customerName
      : customerEmail || customerName || 'MoonSnap Pro';
  const ownerMonogram = ownerLabel.trim().charAt(0).toUpperCase() || 'P';
  const ownerAvatarUrl =
    customerAvatarUrl && /^(data:|blob:|asset:|https:\/\/asset\.localhost)/.test(customerAvatarUrl)
      ? customerAvatarUrl
      : null;
  const hasProProfile = status === 'pro' && (customerName || customerEmail || customerAvatarUrl || deviceName || seatsLimit != null);

  return (
    <div className="space-y-6">
      {/* Status Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          License Status
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]">
          <div className="flex items-center gap-3">
            {statusConfig.icon}
            <div>
              <p className="text-sm font-medium text-[var(--ink-black)]">
                {statusConfig.label}
              </p>
              <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                {statusConfig.description}
              </p>
              {status === 'trial' && trialDaysLeft !== null && (
                <p className="text-xs text-[var(--coral-400)] mt-1">
                  {trialDaysLeft} {trialDaysLeft === 1 ? 'day' : 'days'} remaining
                </p>
              )}
            </div>
          </div>
          {hasProProfile && (
            <div className="mt-4 pt-4 border-t border-[var(--polar-frost)]">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  {ownerAvatarUrl ? (
                    <img
                      src={ownerAvatarUrl}
                      alt={ownerLabel}
                      className="h-12 w-12 rounded-full border border-[var(--polar-frost)] object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--coral-400)] text-sm font-semibold text-white">
                      {ownerMonogram}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--ink-black)]">{ownerLabel}</p>
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                        Pro
                      </span>
                    </div>
                    {customerName && customerEmail && (
                      <p className="truncate text-xs text-[var(--ink-muted)]">{customerEmail}</p>
                    )}
                    {!customerName && customerEmail && (
                      <p className="text-xs text-[var(--ink-muted)]">Polar customer</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  {customerEmail && customerName && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                        <Mail className="h-3.5 w-3.5" />
                        Email
                      </span>
                      <span className="truncate text-xs font-medium text-[var(--ink-black)]">{customerEmail}</span>
                    </div>
                  )}
                  {deviceName && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-[var(--ink-muted)]">
                        <Monitor className="h-3.5 w-3.5" />
                        This device
                      </span>
                      <span className="truncate text-xs font-medium text-[var(--ink-black)]">{deviceName}</span>
                    </div>
                  )}
                  {seatsLimit != null && (
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[var(--ink-muted)]">Device limit</span>
                      <span className="text-xs font-medium text-[var(--ink-black)]">
                        {seatsLimit} {seatsLimit === 1 ? 'device' : 'devices'}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Activate Section (when not Pro) */}
      {status !== 'pro' && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
            Activate License
          </h3>
          <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-4">
            <div>
              <label className="text-sm text-[var(--ink-black)] mb-2 block">
                License key
              </label>
              <div className="flex gap-2">
                <Input
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  className="flex-1 text-sm bg-[var(--card)] font-mono"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleActivate();
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleActivate}
                  disabled={isLoading || !licenseKey.trim()}
                  className="shrink-0 bg-[var(--coral-400)] text-white border-[var(--coral-400)] hover:bg-[var(--coral-500)]"
                >
                  <Key className="w-4 h-4 mr-1" />
                  {isLoading ? 'Activating...' : 'Activate'}
                </Button>
              </div>

              {activationMessage && (
                <p
                  className={`text-xs mt-2 ${
                    activationMessage.success ? 'text-emerald-500' : 'text-red-500'
                  }`}
                >
                  {activationMessage.text}
                </p>
              )}
            </div>

            <div className="pt-2 border-t border-[var(--polar-frost)]">
              <a
                href="https://buy.polar.sh/polar_cl_WDZB2ld3wEqqWTOustdiNZHASOHMOz4lxlsZ03VjJfx"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-[var(--coral-400)] hover:text-[var(--coral-500)] transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Buy MoonSnap Pro — $29
              </a>
            </div>
          </div>
        </section>
      )}

      {/* Manage Section (when Pro) */}
      {status === 'pro' && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
            Manage License
          </h3>
          <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[var(--ink-black)]">
                  Deactivate license
                </p>
                <p className="text-xs text-[var(--ink-muted)] mt-0.5">
                  Remove the license from this device so you can use it on another machine
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDeactivate}
                disabled={isLoading}
                className="shrink-0 bg-[var(--card)] border-[var(--polar-frost)] text-[var(--ink-dark)] hover:bg-[var(--polar-ice)]"
              >
                {isLoading ? 'Deactivating...' : 'Deactivate'}
              </Button>
            </div>
            {activationMessage && (
              <p
                className={`text-xs mt-2 ${
                  activationMessage.success ? 'text-emerald-500' : 'text-red-500'
                }`}
              >
                {activationMessage.text}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
};
