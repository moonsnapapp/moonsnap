//! License validation logic.

use chrono::{Duration, Utc};
use serde::Deserialize;

use super::types::{ActivationResult, LicenseCache, LicenseStatus};

const GRACE_PERIOD_DAYS: i64 = 7;
const POLAR_VALIDATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const POLAR_ACTIVATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/activate";
const POLAR_DEACTIVATE_URL: &str =
    "https://api.polar.sh/v1/customer-portal/license-keys/deactivate";

#[derive(Debug, Deserialize)]
struct PolarValidateResponse {
    pub valid: bool,
}

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
pub fn resolve_status(cache: &LicenseCache, app_version: &str) -> LicenseStatus {
    match cache.status {
        LicenseStatus::Trial => {
            if is_trial_expired(cache) {
                LicenseStatus::Free
            } else {
                LicenseStatus::Trial
            }
        },
        LicenseStatus::Pro => {
            if let Some(v) = cache.licensed_version {
                if !is_version_valid(v, app_version) {
                    return LicenseStatus::Free;
                }
            }
            if cache.last_validated.is_some() && !is_within_grace_period(cache) {
                LicenseStatus::Expired
            } else {
                LicenseStatus::Pro
            }
        },
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
pub async fn deactivate_online(key: &str, device_id: &str) -> Result<(), String> {
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
