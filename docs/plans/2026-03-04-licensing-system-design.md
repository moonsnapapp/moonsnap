# MoonSnap Licensing System Design

**Date:** 2026-03-04
**Status:** Approved

## Decisions

| Decision | Choice |
|---|---|
| Provider | Polar.sh |
| Offline | 7-day grace period, re-validate weekly |
| Free tier | 14-day full trial, then downgrade |
| Devices | 2 per license |
| Pricing | $29 one-time, paid major version upgrades |
| Architecture | Rust-first (Approach A) |

## License Lifecycle

```
Install → 14-day trial (auto, no account needed)
  → Trial expires → Free tier (pro features locked)
  → User buys on Polar.sh → gets license key
  → Enters key in app → Rust validates with Polar.sh API
  → Activated → Pro features unlocked
  → Every 7 days → Rust re-validates silently in background
  → Offline > 7 days → downgrades to Free until reconnected
```

## Feature Matrix

| Feature | Free | Pro ($29) |
|---|:---:|:---:|
| Region/fullscreen capture | Yes | Yes |
| Basic annotation (shapes, text, arrows) | Yes | Yes |
| Capture history & library | Yes | Yes |
| Numbered steps | Yes | Yes |
| Freehand pen | Yes | Yes |
| Video recording | No | Yes |
| GIF export | No | Yes |
| Blur/pixelate tool | No | Yes |
| Custom backgrounds & wallpapers | No | Yes |
| Webcam overlay | No | Yes |
| High-res export | No | Yes |

## Rust Backend Architecture

New module: `src-tauri/src/license/`

```
license/
├── mod.rs           # Module exports
├── cache.rs         # Encrypted local cache read/write (AES-256-GCM)
├── validation.rs    # Polar.sh API calls + offline grace logic
├── device.rs        # Machine fingerprint (machine name + OS ID + disk serial)
├── feature_gate.rs  # Pro feature checks
└── types.rs         # LicenseStatus, LicenseCache, etc.
```

### Local Cache Structure

```rust
struct LicenseCache {
    license_key: String,
    status: LicenseStatus,        // Trial | Pro | Free | Expired
    licensed_version: u32,         // Major version (1, 2, 3...)
    device_id: String,             // Machine fingerprint
    activated_at: DateTime,
    last_validated: DateTime,      // For 7-day grace period
    trial_started: DateTime,       // For 14-day trial countdown
    trial_expires: DateTime,
}
```

Encrypted with AES-256-GCM, key derived from device fingerprint. Unreadable on different machine.

### Tauri Commands

| Command | Purpose |
|---|---|
| `get_license_status` | Returns current tier, days left in trial, licensed version |
| `activate_license` | Takes key string, validates with Polar.sh, activates device |
| `deactivate_license` | Releases device slot, clears local cache |
| `check_trial_status` | Returns trial days remaining or expired |

### Feature Gating in Backend

Pro-only commands get a guard:

```rust
#[tauri::command]
async fn export_video(...) -> Result<...> {
    license::require_pro(app_handle)?;
    // ... existing export logic
}
```

## Frontend Integration

### License Store (Zustand)

```typescript
interface LicenseState {
  status: "trial" | "pro" | "free" | "expired"
  trialDaysLeft: number | null
  licensedVersion: number | null
  fetchStatus: () => Promise<void>
  activate: (key: string) => Promise<ActivationResult>
  deactivate: () => Promise<void>
}
```

No frontend persistence. Always reads from Rust on app launch.

### UI Touchpoints

| Location | Change |
|---|---|
| Settings → new "License" tab | Activate/deactivate key, show status, purchase link |
| Title bar / status area | Badge: "Trial (X days)" or "Pro" or "Free" |
| Pro-gated features | Lock overlay + "Upgrade" button when Free |
| First launch | Welcome modal explaining 14-day trial |
| Trial expiry | One-time modal with Buy + Continue Free buttons |

### Feature Gate Component

```tsx
function ProFeature({ children, featureName }) {
  const status = useLicenseStore(s => s.status)
  if (status === "pro" || status === "trial") return children
  return <UpgradePrompt feature={featureName} />
}
```

## Trial System

- Starts automatically on first launch, no signup required
- Tracked via encrypted cache timestamp
- Secondary marker in Tauri app data directory as backup
- If both markers deleted, new trial starts (acceptable for $29 app)
- At expiry: one-time modal, then lock overlays only (no nag screens)
- User data/captures never locked

## Version Gating for Paid Upgrades

License key tied to major version via Polar.sh product metadata.

- v1.0 → v1.9: License valid
- v2.0: License invalid, upgrade prompt shown
- v1 users keep Free tier access to v2, or stay on v1 forever

Polar.sh setup: one product per major version, coupons for upgrade discounts.

## Out of Scope

- No account system / user login (Polar.sh customer portal handles this)
- No in-app payment processing (redirect to Polar.sh checkout)
- No cloud features (future add-on)
- No complex trial abuse prevention
