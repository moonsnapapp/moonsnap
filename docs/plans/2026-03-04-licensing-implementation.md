# Licensing System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Polar.sh-powered licensing system with 14-day trial, $29 one-time purchase, and Rust-first feature gating.

**Architecture:** Rust backend handles all license logic (validation, caching, encryption, feature gates). Frontend reads state via Tauri commands and renders lock overlays. Polar.sh handles payments, license keys, and customer portal externally.

**Tech Stack:** Rust (AES-256-GCM via `aes-gcm`, `reqwest` for HTTP, `chrono` for dates), TypeScript/React (Zustand store, Tauri invoke), Polar.sh License Key API.

**Design doc:** `docs/plans/2026-03-04-licensing-system-design.md`

---

### Task 1: Add Rust Dependencies

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Step 1: Add dependencies to Cargo.toml**

Add these under `[dependencies]`:

```toml
# Licensing system
reqwest = { version = "0.12", features = ["json", "rustls-tls"], default-features = false }
aes-gcm = "0.10"
sha2 = "0.10"
chrono = { version = "0.4", features = ["serde"] }
base64 = "0.22"
```

`reqwest` for Polar.sh API calls, `aes-gcm` + `sha2` for encrypted cache, `chrono` for trial/validation timestamps, `base64` for encoding encrypted data.

**Step 2: Verify it compiles**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors (warnings OK).

**Step 3: Commit**

```bash
git add apps/desktop/src-tauri/Cargo.toml
git commit -m "feat(license): add crypto, http, and date dependencies for licensing system"
```

---

### Task 2: License Types (Rust + TypeScript Generation)

**Files:**
- Create: `apps/desktop/src-tauri/src/license/types.rs`
- Create: `apps/desktop/src-tauri/src/license/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add `pub mod license;`)

**Step 1: Write the test for type serialization**

In `types.rs`, add at bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_license_status_serialization() {
        let status = LicenseStatus::Trial;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"trial\"");

        let pro = LicenseStatus::Pro;
        let json = serde_json::to_string(&pro).unwrap();
        assert_eq!(json, "\"pro\"");
    }

    #[test]
    fn test_license_cache_roundtrip() {
        let cache = LicenseCache {
            license_key: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test-device".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: chrono::Utc::now(),
            trial_expires: chrono::Utc::now() + chrono::Duration::days(14),
        };

        let json = serde_json::to_string(&cache).unwrap();
        let restored: LicenseCache = serde_json::from_str(&json).unwrap();
        assert_eq!(restored.status, LicenseStatus::Trial);
        assert_eq!(restored.device_id, "test-device");
        assert!(restored.license_key.is_none());
    }

    #[test]
    fn test_license_info_for_frontend() {
        let info = LicenseInfo {
            status: LicenseStatus::Trial,
            trial_days_left: Some(10),
            licensed_version: None,
        };

        let json = serde_json::to_string(&info).unwrap();
        assert!(json.contains("\"trial\""));
        assert!(json.contains("10"));
    }

    #[test]
    fn test_activation_result_success() {
        let result = ActivationResult {
            success: true,
            message: "License activated".to_string(),
        };
        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("true"));
    }
}
```

**Step 2: Write the types**

Create `apps/desktop/src-tauri/src/license/types.rs`:

```rust
//! License system types.
//!
//! Defines all data structures for the licensing system.
//! Types with `#[derive(TS)]` auto-generate TypeScript equivalents.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Current license tier.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub enum LicenseStatus {
    /// Active trial period (14 days from first launch).
    #[serde(rename = "trial")]
    Trial,
    /// Paid Pro license, validated and active.
    #[serde(rename = "pro")]
    Pro,
    /// Free tier (trial expired, no valid license).
    #[serde(rename = "free")]
    Free,
    /// License expired or failed re-validation beyond grace period.
    #[serde(rename = "expired")]
    Expired,
}

/// Encrypted local license cache. Stored on disk, never sent to frontend directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseCache {
    /// Polar.sh license key (None during trial).
    pub license_key: Option<String>,
    /// Current license status.
    pub status: LicenseStatus,
    /// Major version this license covers (None during trial).
    pub licensed_version: Option<u32>,
    /// Machine fingerprint hash.
    pub device_id: String,
    /// When the license was activated (None during trial).
    pub activated_at: Option<DateTime<Utc>>,
    /// Last successful online validation (None if never validated).
    pub last_validated: Option<DateTime<Utc>>,
    /// When the trial started.
    pub trial_started: DateTime<Utc>,
    /// When the trial expires.
    pub trial_expires: DateTime<Utc>,
}

/// License info exposed to the frontend via Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct LicenseInfo {
    /// Current license tier.
    pub status: LicenseStatus,
    /// Days remaining in trial (None if not in trial).
    pub trial_days_left: Option<i64>,
    /// Major version covered by license (None if no license).
    pub licensed_version: Option<u32>,
}

/// Result of a license activation attempt.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ActivationResult {
    pub success: bool,
    pub message: String,
}
```

Create `apps/desktop/src-tauri/src/license/mod.rs`:

```rust
//! License management system.
//!
//! Handles license validation, caching, trial management, and feature gating.
//! All license logic runs in the Rust backend; the frontend reads state via Tauri commands.

pub mod types;

pub use types::*;
```

Modify `apps/desktop/src-tauri/src/lib.rs` — add after existing module declarations:

```rust
pub mod license;
```

**Step 3: Run tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::types::tests`
Expected: All 4 tests pass.

**Step 4: Generate TypeScript types**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: Creates `LicenseStatus.ts`, `LicenseInfo.ts`, `ActivationResult.ts` in `apps/desktop/src/types/generated/`.

**Step 5: Export new types from generated index**

Modify `apps/desktop/src/types/generated/index.ts` — add:

```typescript
// License types
export type { ActivationResult } from './ActivationResult';
export type { LicenseInfo } from './LicenseInfo';
export type { LicenseStatus } from './LicenseStatus';
```

**Step 6: Commit**

```bash
git add apps/desktop/src-tauri/src/license/ apps/desktop/src-tauri/src/lib.rs apps/desktop/src/types/generated/
git commit -m "feat(license): add license types with ts-rs generation"
```

---

### Task 3: Device Fingerprint

**Files:**
- Create: `apps/desktop/src-tauri/src/license/device.rs`
- Modify: `apps/desktop/src-tauri/src/license/mod.rs`

**Step 1: Write failing tests**

In `device.rs`, add at bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_device_id_is_stable() {
        let id1 = generate_device_id();
        let id2 = generate_device_id();
        assert_eq!(id1, id2, "Device ID should be deterministic");
    }

    #[test]
    fn test_device_id_is_hex() {
        let id = generate_device_id();
        assert!(!id.is_empty());
        assert!(id.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn test_derive_encryption_key_from_device_id() {
        let id = generate_device_id();
        let key = derive_encryption_key(&id);
        assert_eq!(key.len(), 32, "AES-256 key must be 32 bytes");
    }

    #[test]
    fn test_derive_key_is_deterministic() {
        let id = generate_device_id();
        let key1 = derive_encryption_key(&id);
        let key2 = derive_encryption_key(&id);
        assert_eq!(key1, key2);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::device::tests`
Expected: FAIL — functions not defined.

**Step 3: Implement device fingerprint**

Create `apps/desktop/src-tauri/src/license/device.rs`:

```rust
//! Machine fingerprint generation.
//!
//! Creates a stable, deterministic device identifier from machine characteristics.
//! Used for license activation (2-device limit) and encryption key derivation.

use sha2::{Digest, Sha256};
use std::env;

/// Generate a deterministic device ID from machine characteristics.
///
/// Uses hostname + OS-level machine identifiers. Stable across reboots,
/// changes if OS is reinstalled (acceptable behavior).
pub fn generate_device_id() -> String {
    let mut hasher = Sha256::new();

    // Hostname
    if let Ok(name) = env::var("COMPUTERNAME") {
        hasher.update(name.as_bytes());
    }

    // Windows machine GUID from registry (stable across reboots)
    #[cfg(target_os = "windows")]
    {
        if let Some(guid) = get_windows_machine_guid() {
            hasher.update(guid.as_bytes());
        }
    }

    // Fallback: username + OS info
    if let Ok(user) = env::var("USERNAME") {
        hasher.update(user.as_bytes());
    }

    let result = hasher.finalize();
    hex::encode(&result[..16]) // 16 bytes = 32 hex chars
}

#[cfg(target_os = "windows")]
fn get_windows_machine_guid() -> Option<String> {
    use std::process::Command;

    let output = Command::new("reg")
        .args([
            "query",
            r"HKLM\SOFTWARE\Microsoft\Cryptography",
            "/v",
            "MachineGuid",
        ])
        .output()
        .ok()?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Parse "MachineGuid    REG_SZ    <guid>" format
    for line in stdout.lines() {
        if line.contains("MachineGuid") {
            return line.split_whitespace().last().map(|s| s.to_string());
        }
    }
    None
}

/// Derive a 32-byte AES-256 encryption key from the device ID.
///
/// Uses SHA-256 hash of the device ID with a salt. The key is tied to this
/// specific machine — encrypted cache files are unreadable elsewhere.
pub fn derive_encryption_key(device_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"moonsnap-license-v1-");
    hasher.update(device_id.as_bytes());
    let result = hasher.finalize();
    result.into()
}
```

Add `hex = "0.4"` to `Cargo.toml` dependencies.

Update `apps/desktop/src-tauri/src/license/mod.rs`:

```rust
pub mod types;
pub mod device;

pub use types::*;
```

**Step 4: Run tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::device::tests`
Expected: All 4 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/license/device.rs apps/desktop/src-tauri/src/license/mod.rs apps/desktop/src-tauri/Cargo.toml
git commit -m "feat(license): add device fingerprint and encryption key derivation"
```

---

### Task 4: Encrypted Cache

**Files:**
- Create: `apps/desktop/src-tauri/src/license/cache.rs`
- Modify: `apps/desktop/src-tauri/src/license/mod.rs`

**Step 1: Write failing tests**

In `cache.rs`, add at bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn test_cache() -> LicenseCache {
        LicenseCache {
            license_key: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test-device-id".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: chrono::Utc::now(),
            trial_expires: chrono::Utc::now() + chrono::Duration::days(14),
        }
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = [0u8; 32];
        let data = b"hello world";
        let encrypted = encrypt_data(&key, data).unwrap();
        let decrypted = decrypt_data(&key, &encrypted).unwrap();
        assert_eq!(decrypted, data);
    }

    #[test]
    fn test_wrong_key_fails_decrypt() {
        let key1 = [0u8; 32];
        let key2 = [1u8; 32];
        let data = b"secret";
        let encrypted = encrypt_data(&key1, data).unwrap();
        assert!(decrypt_data(&key2, &encrypted).is_err());
    }

    #[test]
    fn test_save_and_load_cache() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("license.dat");
        let key = [42u8; 32];
        let cache = test_cache();

        save_cache(&path, &key, &cache).unwrap();
        let loaded = load_cache(&path, &key).unwrap();

        assert_eq!(loaded.status, LicenseStatus::Trial);
        assert_eq!(loaded.device_id, "test-device-id");
    }

    #[test]
    fn test_load_missing_file_returns_none() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("nonexistent.dat");
        let key = [0u8; 32];

        let result = load_cache_optional(&path, &key);
        assert!(result.is_none());
    }
}
```

Add `tempfile = "3"` to `[dev-dependencies]` in Cargo.toml.

**Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::cache::tests`
Expected: FAIL.

**Step 3: Implement encrypted cache**

Create `apps/desktop/src-tauri/src/license/cache.rs`:

```rust
//! Encrypted license cache.
//!
//! Stores license state on disk using AES-256-GCM encryption.
//! The encryption key is derived from the device fingerprint,
//! making the cache file unreadable on a different machine.

use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, AeadCore, Nonce,
};
use std::path::Path;

use super::types::{LicenseCache, LicenseStatus};

/// Encrypt arbitrary data with AES-256-GCM.
/// Returns nonce (12 bytes) || ciphertext.
pub fn encrypt_data(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, String> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let mut output = nonce.to_vec();
    output.extend(ciphertext);
    Ok(output)
}

/// Decrypt data encrypted with `encrypt_data`.
/// Input: nonce (12 bytes) || ciphertext.
pub fn decrypt_data(key: &[u8; 32], data: &[u8]) -> Result<Vec<u8>, String> {
    if data.len() < 12 {
        return Err("Data too short to contain nonce".to_string());
    }

    let cipher = Aes256Gcm::new(key.into());
    let nonce = Nonce::from_slice(&data[..12]);
    let ciphertext = &data[12..];

    cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed (wrong key or corrupted data)".to_string())
}

/// Save license cache to disk, encrypted.
pub fn save_cache(path: &Path, key: &[u8; 32], cache: &LicenseCache) -> Result<(), String> {
    let json = serde_json::to_vec(cache).map_err(|e| format!("Serialize failed: {}", e))?;
    let encrypted = encrypt_data(key, &json)?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    std::fs::write(path, &encrypted).map_err(|e| format!("Failed to write cache: {}", e))?;
    Ok(())
}

/// Load license cache from disk. Returns error if file exists but can't be read.
pub fn load_cache(path: &Path, key: &[u8; 32]) -> Result<LicenseCache, String> {
    let data = std::fs::read(path).map_err(|e| format!("Failed to read cache: {}", e))?;
    let decrypted = decrypt_data(key, &data)?;
    serde_json::from_slice(&decrypted).map_err(|e| format!("Deserialize failed: {}", e))
}

/// Load cache if it exists, return None if file is missing.
pub fn load_cache_optional(path: &Path, key: &[u8; 32]) -> Option<LicenseCache> {
    if !path.exists() {
        return None;
    }
    load_cache(path, key).ok()
}
```

Update `mod.rs`:

```rust
pub mod types;
pub mod device;
pub mod cache;

pub use types::*;
```

**Step 4: Run tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::cache::tests`
Expected: All 4 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/license/cache.rs apps/desktop/src-tauri/src/license/mod.rs apps/desktop/src-tauri/Cargo.toml
git commit -m "feat(license): add AES-256-GCM encrypted cache for license state"
```

---

### Task 5: Polar.sh API Validation

**Files:**
- Create: `apps/desktop/src-tauri/src/license/validation.rs`
- Modify: `apps/desktop/src-tauri/src/license/mod.rs`

**Step 1: Write failing tests**

In `validation.rs`, add at bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trial_not_expired() {
        let cache = LicenseCache {
            license_key: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: Utc::now(),
            trial_expires: Utc::now() + Duration::days(14),
        };
        assert!(!is_trial_expired(&cache));
    }

    #[test]
    fn test_trial_expired() {
        let cache = LicenseCache {
            license_key: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: Utc::now() - Duration::days(15),
            trial_expires: Utc::now() - Duration::days(1),
        };
        assert!(is_trial_expired(&cache));
    }

    #[test]
    fn test_grace_period_valid() {
        let cache = LicenseCache {
            license_key: Some("key".to_string()),
            status: LicenseStatus::Pro,
            licensed_version: Some(1),
            device_id: "test".to_string(),
            activated_at: Some(Utc::now()),
            last_validated: Some(Utc::now() - Duration::days(3)),
            trial_started: Utc::now() - Duration::days(30),
            trial_expires: Utc::now() - Duration::days(16),
        };
        assert!(is_within_grace_period(&cache));
    }

    #[test]
    fn test_grace_period_expired() {
        let cache = LicenseCache {
            license_key: Some("key".to_string()),
            status: LicenseStatus::Pro,
            licensed_version: Some(1),
            device_id: "test".to_string(),
            activated_at: Some(Utc::now()),
            last_validated: Some(Utc::now() - Duration::days(10)),
            trial_started: Utc::now() - Duration::days(30),
            trial_expires: Utc::now() - Duration::days(16),
        };
        assert!(!is_within_grace_period(&cache));
    }

    #[test]
    fn test_version_check_same_major() {
        assert!(is_version_valid(1, "1.5.7"));
    }

    #[test]
    fn test_version_check_newer_major() {
        assert!(!is_version_valid(1, "2.0.0"));
    }

    #[test]
    fn test_trial_days_left() {
        let cache = LicenseCache {
            license_key: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: Utc::now() - Duration::days(4),
            trial_expires: Utc::now() + Duration::days(10),
        };
        let days = trial_days_left(&cache);
        assert!(days >= 9 && days <= 10);
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::validation::tests`
Expected: FAIL.

**Step 3: Implement validation logic**

Create `apps/desktop/src-tauri/src/license/validation.rs`:

```rust
//! License validation logic.
//!
//! Handles Polar.sh API validation, trial expiry checks,
//! grace period logic, and version gating.

use chrono::{Duration, Utc};
use serde::Deserialize;

use super::types::{ActivationResult, LicenseCache, LicenseStatus};

const GRACE_PERIOD_DAYS: i64 = 7;
const POLAR_VALIDATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const POLAR_ACTIVATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/activate";
const POLAR_DEACTIVATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/deactivate";

/// Polar.sh license validation response (relevant fields).
#[derive(Debug, Deserialize)]
struct PolarValidateResponse {
    pub valid: bool,
}

/// Polar.sh activation response.
#[derive(Debug, Deserialize)]
struct PolarActivateResponse {
    pub id: String,
}

/// Check if the trial period has expired.
pub fn is_trial_expired(cache: &LicenseCache) -> bool {
    Utc::now() > cache.trial_expires
}

/// Check if a Pro license is within the 7-day offline grace period.
pub fn is_within_grace_period(cache: &LicenseCache) -> bool {
    match cache.last_validated {
        Some(last) => (Utc::now() - last).num_days() < GRACE_PERIOD_DAYS,
        None => false,
    }
}

/// Check if a license version covers the current app version.
pub fn is_version_valid(licensed_version: u32, app_version: &str) -> bool {
    let app_major: u32 = app_version
        .split('.')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    licensed_version >= app_major
}

/// Get remaining trial days (0 if expired).
pub fn trial_days_left(cache: &LicenseCache) -> i64 {
    let remaining = cache.trial_expires - Utc::now();
    remaining.num_days().max(0)
}

/// Resolve the effective license status from the cache.
///
/// Checks trial expiry, grace period, and version validity.
pub fn resolve_status(cache: &LicenseCache, app_version: &str) -> LicenseStatus {
    match cache.status {
        LicenseStatus::Trial => {
            if is_trial_expired(cache) {
                LicenseStatus::Free
            } else {
                LicenseStatus::Trial
            }
        }
        LicenseStatus::Pro => {
            // Check version gating
            if let Some(v) = cache.licensed_version {
                if !is_version_valid(v, app_version) {
                    return LicenseStatus::Free;
                }
            }
            // Check grace period (offline tolerance)
            if cache.last_validated.is_some() && !is_within_grace_period(cache) {
                LicenseStatus::Expired
            } else {
                LicenseStatus::Pro
            }
        }
        LicenseStatus::Free => LicenseStatus::Free,
        LicenseStatus::Expired => LicenseStatus::Expired,
    }
}

/// Validate a license key with Polar.sh API.
pub async fn validate_online(key: &str) -> Result<bool, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(POLAR_VALIDATE_URL)
        .json(&serde_json::json!({
            "key": key,
            "organization_id": std::env::var("POLAR_ORG_ID").unwrap_or_default(),
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Polar API error: {}", resp.status()));
    }

    let body: PolarValidateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(body.valid)
}

/// Activate a license key on this device with Polar.sh.
pub async fn activate_online(
    key: &str,
    device_id: &str,
    label: &str,
) -> Result<ActivationResult, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(POLAR_ACTIVATE_URL)
        .json(&serde_json::json!({
            "key": key,
            "organization_id": std::env::var("POLAR_ORG_ID").unwrap_or_default(),
            "label": label,
            "meta": {
                "device_id": device_id,
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Ok(ActivationResult {
            success: false,
            message: format!("Activation failed ({}): {}", status, body),
        });
    }

    let _body: PolarActivateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(ActivationResult {
        success: true,
        message: "License activated successfully".to_string(),
    })
}

/// Deactivate a license key on this device with Polar.sh.
pub async fn deactivate_online(
    key: &str,
    device_id: &str,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .post(POLAR_DEACTIVATE_URL)
        .json(&serde_json::json!({
            "key": key,
            "organization_id": std::env::var("POLAR_ORG_ID").unwrap_or_default(),
            "meta": {
                "device_id": device_id,
            }
        }))
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Deactivation failed: {}", resp.status()));
    }

    Ok(())
}
```

Update `mod.rs`:

```rust
pub mod types;
pub mod device;
pub mod cache;
pub mod validation;

pub use types::*;
```

**Step 4: Run tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::validation::tests`
Expected: All 7 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/license/validation.rs apps/desktop/src-tauri/src/license/mod.rs
git commit -m "feat(license): add Polar.sh validation, trial expiry, and grace period logic"
```

---

### Task 6: Feature Gate Module

**Files:**
- Create: `apps/desktop/src-tauri/src/license/feature_gate.rs`
- Modify: `apps/desktop/src-tauri/src/license/mod.rs`

**Step 1: Write failing tests**

In `feature_gate.rs`, add at bottom:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pro_features_list() {
        assert!(is_pro_feature("video_recording"));
        assert!(is_pro_feature("gif_export"));
        assert!(is_pro_feature("blur_tool"));
        assert!(is_pro_feature("custom_backgrounds"));
        assert!(is_pro_feature("webcam_overlay"));
        assert!(is_pro_feature("high_res_export"));
    }

    #[test]
    fn test_free_features_not_gated() {
        assert!(!is_pro_feature("screenshot"));
        assert!(!is_pro_feature("basic_annotation"));
        assert!(!is_pro_feature("unknown_feature"));
    }
}
```

**Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::feature_gate::tests`
Expected: FAIL.

**Step 3: Implement feature gate**

Create `apps/desktop/src-tauri/src/license/feature_gate.rs`:

```rust
//! Feature gating for Pro-only functionality.
//!
//! Provides a guard function that Tauri commands call to check
//! if the current license tier allows the operation.

use super::types::LicenseStatus;

/// Features that require a Pro license.
const PRO_FEATURES: &[&str] = &[
    "video_recording",
    "gif_export",
    "blur_tool",
    "custom_backgrounds",
    "webcam_overlay",
    "high_res_export",
];

/// Check if a feature name requires Pro.
pub fn is_pro_feature(feature: &str) -> bool {
    PRO_FEATURES.contains(&feature)
}

/// Guard: returns Ok(()) if status allows Pro features, Err otherwise.
pub fn require_pro(status: &LicenseStatus) -> Result<(), String> {
    match status {
        LicenseStatus::Pro | LicenseStatus::Trial => Ok(()),
        LicenseStatus::Free => Err("This feature requires MoonSnap Pro. Upgrade at https://polar.sh/moonsnap".to_string()),
        LicenseStatus::Expired => Err("Your license has expired. Please reconnect to the internet to re-validate, or upgrade at https://polar.sh/moonsnap".to_string()),
    }
}
```

Update `mod.rs`:

```rust
pub mod types;
pub mod device;
pub mod cache;
pub mod validation;
pub mod feature_gate;

pub use types::*;
```

**Step 4: Run tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib license::feature_gate::tests`
Expected: All 2 tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/license/feature_gate.rs apps/desktop/src-tauri/src/license/mod.rs
git commit -m "feat(license): add feature gate module for pro-only command guards"
```

---

### Task 7: Tauri License Commands

**Files:**
- Create: `apps/desktop/src-tauri/src/commands/license.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/commands/registry.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add LicenseState to setup)

**Step 1: Implement the license commands**

Create `apps/desktop/src-tauri/src/commands/license.rs`:

```rust
//! Tauri commands for the licensing system.
//!
//! These commands are the only interface between the frontend and license logic.
//! The frontend never touches the cache or Polar.sh API directly.

use std::path::PathBuf;
use std::sync::Arc;
use parking_lot::RwLock;
use tauri::Manager;

use crate::license::{
    cache, device, feature_gate, validation, ActivationResult, LicenseCache, LicenseInfo,
    LicenseStatus,
};

const CACHE_FILENAME: &str = "license.dat";
const TRIAL_DAYS: i64 = 14;

/// Managed state holding the current license cache in memory.
pub struct LicenseState {
    pub cache: Arc<RwLock<Option<LicenseCache>>>,
    pub encryption_key: [u8; 32],
    pub cache_path: PathBuf,
    pub device_id: String,
}

impl LicenseState {
    pub fn new(app_data_dir: PathBuf) -> Self {
        let device_id = device::generate_device_id();
        let encryption_key = device::derive_encryption_key(&device_id);
        let cache_path = app_data_dir.join(CACHE_FILENAME);

        // Load existing cache or create trial
        let existing = cache::load_cache_optional(&cache_path, &encryption_key);
        let license_cache = existing.unwrap_or_else(|| {
            let now = chrono::Utc::now();
            let trial = LicenseCache {
                license_key: None,
                status: LicenseStatus::Trial,
                licensed_version: None,
                device_id: device_id.clone(),
                activated_at: None,
                last_validated: None,
                trial_started: now,
                trial_expires: now + chrono::Duration::days(TRIAL_DAYS),
            };
            // Save the new trial cache
            if let Err(e) = cache::save_cache(&cache_path, &encryption_key, &trial) {
                log::error!("Failed to save initial trial cache: {}", e);
            }
            trial
        });

        Self {
            cache: Arc::new(RwLock::new(Some(license_cache))),
            encryption_key,
            cache_path,
            device_id,
        }
    }
}

fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Get the current license status for the frontend.
#[tauri::command]
pub fn get_license_status(state: tauri::State<'_, LicenseState>) -> Result<LicenseInfo, String> {
    let guard = state.cache.read();
    let cache = guard.as_ref().ok_or("License not initialized")?;

    let effective_status = validation::resolve_status(cache, &app_version());
    let trial_days = if cache.status == LicenseStatus::Trial {
        Some(validation::trial_days_left(cache))
    } else {
        None
    };

    Ok(LicenseInfo {
        status: effective_status,
        trial_days_left: trial_days,
        licensed_version: cache.licensed_version,
    })
}

/// Activate a license key.
#[tauri::command]
pub async fn activate_license(
    key: String,
    state: tauri::State<'_, LicenseState>,
) -> Result<ActivationResult, String> {
    let device_id = state.device_id.clone();
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());

    // Activate with Polar.sh
    let result = validation::activate_online(&key, &device_id, &hostname).await?;

    if result.success {
        let now = chrono::Utc::now();
        let mut guard = state.cache.write();
        if let Some(ref mut c) = *guard {
            c.license_key = Some(key);
            c.status = LicenseStatus::Pro;
            c.licensed_version = Some(
                app_version()
                    .split('.')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1),
            );
            c.activated_at = Some(now);
            c.last_validated = Some(now);

            // Save to disk
            if let Err(e) = cache::save_cache(&state.cache_path, &state.encryption_key, c) {
                log::error!("Failed to save license cache: {}", e);
            }
        }
    }

    Ok(result)
}

/// Deactivate the license on this device.
#[tauri::command]
pub async fn deactivate_license(
    state: tauri::State<'_, LicenseState>,
) -> Result<(), String> {
    let guard = state.cache.read();
    let cache = guard.as_ref().ok_or("License not initialized")?;
    let key = cache
        .license_key
        .as_ref()
        .ok_or("No license key to deactivate")?
        .clone();
    let device_id = state.device_id.clone();
    drop(guard);

    // Deactivate with Polar.sh
    validation::deactivate_online(&key, &device_id).await?;

    // Reset to free tier locally
    let mut guard = state.cache.write();
    if let Some(ref mut c) = *guard {
        c.license_key = None;
        c.status = LicenseStatus::Free;
        c.licensed_version = None;
        c.activated_at = None;
        c.last_validated = None;

        if let Err(e) = cache::save_cache(&state.cache_path, &state.encryption_key, c) {
            log::error!("Failed to save license cache after deactivation: {}", e);
        }
    }

    Ok(())
}

/// Check if a specific pro feature is allowed.
#[tauri::command]
pub fn check_pro_feature(
    feature: String,
    state: tauri::State<'_, LicenseState>,
) -> Result<bool, String> {
    if !feature_gate::is_pro_feature(&feature) {
        return Ok(true); // Free feature, always allowed
    }

    let guard = state.cache.read();
    let cache = guard.as_ref().ok_or("License not initialized")?;
    let status = validation::resolve_status(cache, &app_version());
    Ok(feature_gate::require_pro(&status).is_ok())
}
```

**Step 2: Register commands and add module**

Add `pub mod license;` to `apps/desktop/src-tauri/src/commands/mod.rs`.

Add to registry macro in `apps/desktop/src-tauri/src/commands/registry.rs`:

```rust
// License commands
crate::commands::license::get_license_status,
crate::commands::license::activate_license,
crate::commands::license::deactivate_license,
crate::commands::license::check_pro_feature,
```

**Step 3: Initialize LicenseState in app setup**

In `apps/desktop/src-tauri/src/lib.rs`, inside the `.setup(|app| { ... })` block, add after other `app.manage()` calls:

```rust
// Initialize license state
let app_data_dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("Failed to get app data dir: {}", e).into())?;
app.manage(commands::license::LicenseState::new(app_data_dir));
```

**Step 4: Verify it compiles**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles with no errors.

**Step 5: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/license.rs apps/desktop/src-tauri/src/commands/mod.rs apps/desktop/src-tauri/src/commands/registry.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(license): add Tauri license commands with managed state"
```

---

### Task 8: Frontend License Store

**Files:**
- Create: `apps/desktop/src/stores/licenseStore.ts`
- Create: `apps/desktop/src/stores/licenseStore.test.ts`

**Step 1: Write the test**

Create `apps/desktop/src/stores/licenseStore.test.ts`:

```typescript
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
      });

      await useLicenseStore.getState().fetchStatus();

      const state = useLicenseStore.getState();
      expect(state.status).toBe('pro');
      expect(state.licensedVersion).toBe(1);
      expect(mockInvoke).toHaveBeenCalledWith('get_license_status');
    });

    it('should handle fetch errors gracefully', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      await useLicenseStore.getState().fetchStatus();

      // Should not crash, status unchanged
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
        });

      const result = await useLicenseStore.getState().activate('test-key');

      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('activate_license', { key: 'test-key' });
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
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `cd apps/desktop && npx vitest run src/stores/licenseStore.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement the store**

Create `apps/desktop/src/stores/licenseStore.ts`:

```typescript
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { invoke } from '@tauri-apps/api/core';
import type { LicenseInfo, LicenseStatus, ActivationResult } from '../types/generated';

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
          const info = await invoke<LicenseInfo>('get_license_status');
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
```

**Step 4: Run tests**

Run: `cd apps/desktop && npx vitest run src/stores/licenseStore.test.ts`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add apps/desktop/src/stores/licenseStore.ts apps/desktop/src/stores/licenseStore.test.ts
git commit -m "feat(license): add frontend license store with Tauri command integration"
```

---

### Task 9: ProFeature Gate Component

**Files:**
- Create: `apps/desktop/src/components/ProFeature.tsx`

**Step 1: Create the gate component**

Create `apps/desktop/src/components/ProFeature.tsx`:

```tsx
import React from 'react';
import { Lock } from 'lucide-react';
import { useLicenseStore } from '../stores/licenseStore';

interface ProFeatureProps {
  children: React.ReactNode;
  featureName: string;
}

/**
 * Wraps pro-only UI. Shows children when Pro/Trial, shows upgrade prompt when Free/Expired.
 */
export function ProFeature({ children, featureName }: ProFeatureProps) {
  const isPro = useLicenseStore((s) => s.isPro());

  if (isPro) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div className="pointer-events-none opacity-40 select-none">{children}</div>
      <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/20 rounded-lg backdrop-blur-[2px]">
        <Lock className="w-5 h-5 text-white mb-1.5" />
        <span className="text-xs font-medium text-white">{featureName}</span>
        <button
          className="mt-2 px-3 py-1 text-xs font-medium text-white bg-[var(--coral-500)] hover:bg-[var(--coral-600)] rounded-md transition-colors"
          onClick={() => {
            window.open('https://polar.sh/moonsnap', '_blank');
          }}
        >
          Upgrade to Pro
        </button>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add apps/desktop/src/components/ProFeature.tsx
git commit -m "feat(license): add ProFeature gate component with upgrade overlay"
```

---

### Task 10: License Settings Tab

**Files:**
- Create: `apps/desktop/src/components/Settings/LicenseTab.tsx`
- Modify: Settings window to include the new tab (file TBD — check how settings tabs are routed)

**Step 1: Create the License tab component**

Create `apps/desktop/src/components/Settings/LicenseTab.tsx`:

```tsx
import React, { useEffect, useState } from 'react';
import { Key, CheckCircle, AlertCircle, Clock, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLicenseStore } from '@/stores/licenseStore';

export const LicenseTab: React.FC = () => {
  const { status, trialDaysLeft, isLoading, fetchStatus, activate, deactivate } =
    useLicenseStore();
  const [licenseKey, setLicenseKey] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleActivate = async () => {
    if (!licenseKey.trim()) return;
    setMessage(null);
    const result = await activate(licenseKey.trim());
    setMessage({ text: result.message, error: !result.success });
    if (result.success) {
      setLicenseKey('');
    }
  };

  const handleDeactivate = async () => {
    setMessage(null);
    await deactivate();
    setMessage({ text: 'License deactivated', error: false });
  };

  return (
    <div className="space-y-6">
      {/* Status Section */}
      <section>
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
          License Status
        </h3>
        <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)]">
          <div className="flex items-center gap-3">
            {status === 'pro' && (
              <>
                <CheckCircle className="w-5 h-5 text-green-500" />
                <div>
                  <p className="font-medium text-sm">MoonSnap Pro</p>
                  <p className="text-xs text-[var(--text-secondary)]">All features unlocked</p>
                </div>
              </>
            )}
            {status === 'trial' && (
              <>
                <Clock className="w-5 h-5 text-blue-500" />
                <div>
                  <p className="font-medium text-sm">Free Trial</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {trialDaysLeft !== null ? `${trialDaysLeft} days remaining` : 'Trial active'}
                  </p>
                </div>
              </>
            )}
            {(status === 'free' || status === 'expired') && (
              <>
                <AlertCircle className="w-5 h-5 text-amber-500" />
                <div>
                  <p className="font-medium text-sm">Free Plan</p>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {status === 'expired' ? 'License expired' : 'Upgrade to unlock all features'}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Activate Section (show when not Pro) */}
      {status !== 'pro' && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
            Activate License
          </h3>
          <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-3">
            <div className="flex gap-2">
              <Input
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Enter your license key"
                className="flex-1 text-sm"
              />
              <Button onClick={handleActivate} disabled={isLoading || !licenseKey.trim()} size="sm">
                <Key className="w-4 h-4 mr-1.5" />
                Activate
              </Button>
            </div>
            {message && (
              <p className={`text-xs ${message.error ? 'text-red-500' : 'text-green-500'}`}>
                {message.text}
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-[var(--text-secondary)]">Don't have a key?</span>
              <button
                className="text-xs text-[var(--coral-500)] hover:text-[var(--coral-600)] inline-flex items-center gap-1"
                onClick={() => window.open('https://polar.sh/moonsnap', '_blank')}
              >
                Buy MoonSnap Pro — $29
                <ExternalLink className="w-3 h-3" />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* Deactivate Section (show when Pro) */}
      {status === 'pro' && (
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--coral-400)] mb-3">
            Manage License
          </h3>
          <div className="p-4 rounded-lg bg-[var(--polar-ice)] border border-[var(--polar-frost)] space-y-3">
            <p className="text-xs text-[var(--text-secondary)]">
              Deactivating frees up a device slot so you can activate on another machine.
            </p>
            <Button onClick={handleDeactivate} disabled={isLoading} variant="outline" size="sm">
              Deactivate on this device
            </Button>
          </div>
        </section>
      )}
    </div>
  );
};
```

**Step 2: Wire into settings tabs**

Find how settings tabs are routed (check the settings window component) and add `'license'` as a tab option alongside `'general'` and `'shortcuts'`. Import and render `<LicenseTab />` when active.

This step requires reading the actual settings window component to see the exact tab routing mechanism — adapt accordingly.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/Settings/LicenseTab.tsx
git commit -m "feat(license): add License settings tab with activation UI"
```

---

### Task 11: Initialize License on App Launch

**Files:**
- Modify: App entry point / root component (find where `loadSettings` is called on mount)

**Step 1: Add license fetch to app initialization**

Find the root component that calls `useSettingsStore().loadSettings()` on mount. Add next to it:

```typescript
import { useLicenseStore } from '@/stores/licenseStore';

// Inside useEffect or initialization logic:
useLicenseStore.getState().fetchStatus();
```

**Step 2: Verify the app boots with license state**

Run: `npm run tauri dev`
Expected: App launches, license store populates with trial status. Check devtools for LicenseStore state.

**Step 3: Commit**

```bash
git add <modified-file>
git commit -m "feat(license): initialize license state on app launch"
```

---

### Task 12: Add Pro Gates to Backend Commands

**Files:**
- Modify: Existing Tauri commands that should be pro-only (video export, GIF export, etc.)

**Step 1: Identify pro-gated commands**

Search for commands related to: video recording start, GIF export, blur/pixelate filter application, webcam overlay, custom background application.

**Step 2: Add guards**

For each pro-only command, add at the top:

```rust
use crate::commands::license::LicenseState;
use crate::license::{feature_gate, validation};

// Inside the command function, add as first line:
let license = state.inner(); // where state: tauri::State<'_, LicenseState>
{
    let guard = license.cache.read();
    if let Some(ref cache) = *guard {
        let status = validation::resolve_status(cache, env!("CARGO_PKG_VERSION"));
        feature_gate::require_pro(&status)?;
    }
}
```

Add `state: tauri::State<'_, LicenseState>` parameter to each gated command.

**Step 3: Verify it compiles**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/
git commit -m "feat(license): add pro feature guards to video, GIF, blur, and webcam commands"
```

---

### Task 13: Add ProFeature Wrappers to Frontend

**Files:**
- Modify: UI components that expose pro-only features

**Step 1: Identify and wrap pro features in the UI**

Find components for: video recording button, GIF export option, blur/pixelate tool, custom background picker, webcam overlay toggle.

Wrap each with:

```tsx
<ProFeature featureName="Video Recording">
  <ExistingVideoButton />
</ProFeature>
```

**Step 2: Test visually**

Run: `npm run tauri dev`
Expected: During trial, all features work. After manually setting status to `'free'` in devtools, pro features show lock overlay.

**Step 3: Commit**

```bash
git add apps/desktop/src/components/
git commit -m "feat(license): wrap pro-only UI features with ProFeature gate"
```

---

### Task 14: Background Re-validation

**Files:**
- Modify: `apps/desktop/src-tauri/src/commands/license.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs` (add background task in setup)

**Step 1: Add re-validation function**

Add to `commands/license.rs`:

```rust
/// Background task: re-validate license every 7 days.
pub async fn background_revalidation(state: Arc<RwLock<Option<LicenseCache>>>, encryption_key: [u8; 32], cache_path: PathBuf) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await; // Check hourly

        let needs_validation = {
            let guard = state.read();
            guard.as_ref().map_or(false, |c| {
                c.status == LicenseStatus::Pro
                    && c.last_validated
                        .map_or(true, |last| (chrono::Utc::now() - last).num_days() >= 7)
            })
        };

        if needs_validation {
            let key = {
                let guard = state.read();
                guard.as_ref().and_then(|c| c.license_key.clone())
            };

            if let Some(key) = key {
                match validation::validate_online(&key).await {
                    Ok(true) => {
                        let mut guard = state.write();
                        if let Some(ref mut c) = *guard {
                            c.last_validated = Some(chrono::Utc::now());
                            let _ = cache::save_cache(&cache_path, &encryption_key, c);
                            log::info!("License re-validated successfully");
                        }
                    }
                    Ok(false) => {
                        let mut guard = state.write();
                        if let Some(ref mut c) = *guard {
                            c.status = LicenseStatus::Expired;
                            let _ = cache::save_cache(&cache_path, &encryption_key, c);
                            log::warn!("License validation failed — key revoked");
                        }
                    }
                    Err(e) => {
                        log::warn!("License re-validation network error (will retry): {}", e);
                    }
                }
            }
        }
    }
}
```

**Step 2: Spawn background task in setup**

In `lib.rs` setup, after managing LicenseState:

```rust
// Spawn background license re-validation
{
    let license_state: tauri::State<'_, commands::license::LicenseState> = app.state();
    let cache = license_state.cache.clone();
    let key = license_state.encryption_key;
    let path = license_state.cache_path.clone();
    tauri::async_runtime::spawn(async move {
        commands::license::background_revalidation(cache, key, path).await;
    });
}
```

**Step 3: Verify it compiles**

Run: `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`
Expected: Compiles.

**Step 4: Commit**

```bash
git add apps/desktop/src-tauri/src/commands/license.rs apps/desktop/src-tauri/src/lib.rs
git commit -m "feat(license): add hourly background re-validation with 7-day grace period"
```

---

### Task 15: Run Full Quality Suite

**Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: No errors.

**Step 2: Run lint**

Run: `bun run lint`
Expected: No errors (or only pre-existing ones).

**Step 3: Run tests**

Run: `bun run test:run`
Expected: All tests pass including new license tests.

**Step 4: Run Rust tests**

Run: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`
Expected: All license tests pass.

**Step 5: Commit any fixes**

If any issues found, fix and commit.

---

### Task 16: Integration Test — Manual Smoke Test

**Step 1: Run the full app**

Run: `npm run tauri dev`

**Step 2: Verify trial flow**

- App should show "Trial" status in license settings tab
- All features should work during trial
- Trial days remaining should display correctly

**Step 3: Verify free tier flow**

- Manually expire the trial (modify cache or wait)
- Pro features should show lock overlays
- Backend should reject pro commands with error message

**Step 4: Verify activation flow**

- Enter an invalid key → should show error
- (If Polar.sh account is set up) Enter a valid key → should activate

**Step 5: Document any issues and fix**

---
