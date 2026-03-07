//! License validation logic.

#[cfg(test)]
use chrono::Duration as ChronoDuration;
use chrono::Utc;
use reqwest::header::RETRY_AFTER;
use reqwest::StatusCode;
use serde::Deserialize;
use std::sync::OnceLock;
use std::time::{Duration as StdDuration, Instant};
use tokio::sync::Mutex;

use super::types::{ActivationResult, LicenseCache, LicenseStatus};

const GRACE_PERIOD_HOURS: i64 = 24;

/// Your Polar.sh organization ID. Find it at https://polar.sh/dashboard → Settings.
const POLAR_ORG_ID: &str = "1fbf151c-4527-4fc2-beba-912f551004d5";

const POLAR_VALIDATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/validate";
const POLAR_ACTIVATE_URL: &str = "https://api.polar.sh/v1/customer-portal/license-keys/activate";
const POLAR_DEACTIVATE_URL: &str =
    "https://api.polar.sh/v1/customer-portal/license-keys/deactivate";
// Polar unauthenticated license endpoints are limited to 3 req/sec.
// We serialize requests and enforce >=350ms spacing to stay under the limit.
const POLAR_UNAUTH_MIN_INTERVAL: StdDuration = StdDuration::from_millis(350);
static POLAR_UNAUTH_REQUEST_GATE: OnceLock<Mutex<Instant>> = OnceLock::new();

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PolarActivation {
    pub id: String,
    pub label: Option<String>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct PolarCustomer {
    pub name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PolarUser {
    pub public_name: Option<String>,
    pub email: Option<String>,
    pub avatar_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct PolarValidateResponse {
    pub valid: Option<bool>,
    pub status: Option<String>,
    pub limit_activations: Option<u32>,
    pub activation: Option<PolarActivation>,
    pub customer: Option<PolarCustomer>,
    pub user: Option<PolarUser>,
    pub usage: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[allow(dead_code)]
struct PolarActivateResponse {
    pub id: String,
    pub label: Option<String>,
}

/// Info about active seats returned from validation.
pub struct ValidationInfo {
    pub valid: bool,
    pub seats_used: Option<u32>,
    pub seats_limit: Option<u32>,
    pub device_name: Option<String>,
    pub customer_name: Option<String>,
    pub customer_email: Option<String>,
    pub customer_avatar_url: Option<String>,
}

fn parse_validate_response(raw: &str, status: StatusCode) -> Result<ValidationInfo, String> {
    let body: PolarValidateResponse = serde_json::from_str(raw).map_err(|e| {
        let preview: String = raw.chars().take(200).collect();
        format!(
            "Parse error (status {}): {} | body preview: {}",
            status, e, preview
        )
    })?;

    let customer_name = body
        .customer
        .as_ref()
        .and_then(|customer| customer.name.clone())
        .or_else(|| {
            body.user
                .as_ref()
                .and_then(|user| user.public_name.clone())
                .filter(|name| !name.trim().is_empty())
        });
    let customer_email = body
        .customer
        .as_ref()
        .and_then(|customer| customer.email.clone())
        .or_else(|| body.user.as_ref().and_then(|user| user.email.clone()));
    let customer_avatar_url = body
        .customer
        .and_then(|customer| customer.avatar_url)
        .or_else(|| body.user.and_then(|user| user.avatar_url));

    Ok(ValidationInfo {
        valid: body
            .valid
            .unwrap_or(matches!(body.status.as_deref(), Some("granted"))),
        seats_used: body.usage,
        seats_limit: body.limit_activations,
        device_name: body.activation.and_then(|a| a.label),
        customer_name,
        customer_email,
        customer_avatar_url,
    })
}

async fn throttle_unauth_polar_request() {
    let gate = POLAR_UNAUTH_REQUEST_GATE
        .get_or_init(|| Mutex::new(Instant::now() - POLAR_UNAUTH_MIN_INTERVAL));
    let mut last_request = gate.lock().await;
    let elapsed = last_request.elapsed();
    if elapsed < POLAR_UNAUTH_MIN_INTERVAL {
        tokio::time::sleep(POLAR_UNAUTH_MIN_INTERVAL - elapsed).await;
    }
    *last_request = Instant::now();
}

/// Check if the trial period has expired.
pub fn is_trial_expired(cache: &LicenseCache) -> bool {
    Utc::now() > cache.trial_expires
}

/// Check if a Pro license is within the 24-hour offline grace period.
pub fn is_within_grace_period(cache: &LicenseCache) -> bool {
    match cache.last_validated {
        Some(last) => (Utc::now() - last).num_hours() < GRACE_PERIOD_HOURS,
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
pub async fn validate_online(
    key: &str,
    activation_id: Option<&str>,
) -> Result<ValidationInfo, String> {
    let client = reqwest::Client::new();
    let mut body = serde_json::json!({
        "key": key,
        "organization_id": POLAR_ORG_ID,
    });
    if let Some(act_id) = activation_id {
        body["activation_id"] = serde_json::json!(act_id);
    }
    throttle_unauth_polar_request().await;
    let resp = client
        .post(POLAR_VALIDATE_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        if status == StatusCode::TOO_MANY_REQUESTS {
            let retry_after_secs = parse_retry_after_seconds(&resp).unwrap_or(2);
            return Err(format!(
                "Polar API rate-limited validate (429). Retry in {} seconds.",
                retry_after_secs
            ));
        }

        let body = resp.text().await.unwrap_or_default();
        if body.is_empty() {
            return Err(format!("Polar API error: {}", status));
        }
        return Err(format!("Polar API error ({}): {}", status, body));
    }

    let raw = resp
        .text()
        .await
        .map_err(|e| format!("Parse error reading response body: {}", e))?;
    parse_validate_response(&raw, status)
}

/// Result of a successful activation, including the Polar activation ID.
pub struct ActivationOnlineResult {
    pub result: ActivationResult,
    pub activation_id: Option<String>,
}

fn parse_retry_after_seconds(resp: &reqwest::Response) -> Option<u64> {
    let value = resp.headers().get(RETRY_AFTER)?;
    let text = value.to_str().ok()?;
    text.trim().parse::<u64>().ok()
}

/// Activate a license key on this device with Polar.sh.
pub async fn activate_online(
    key: &str,
    device_id: &str,
    label: &str,
) -> Result<ActivationOnlineResult, String> {
    let client = reqwest::Client::new();
    throttle_unauth_polar_request().await;
    let resp = client
        .post(POLAR_ACTIVATE_URL)
        .json(&serde_json::json!({
            "key": key,
            "organization_id": POLAR_ORG_ID,
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
        return Ok(ActivationOnlineResult {
            result: ActivationResult {
                success: false,
                message: format!("Activation failed ({}): {}", status, body),
            },
            activation_id: None,
        });
    }

    let body: PolarActivateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    Ok(ActivationOnlineResult {
        result: ActivationResult {
            success: true,
            message: "License activated successfully".to_string(),
        },
        activation_id: Some(body.id),
    })
}

/// Deactivate a license key on this device with Polar.sh.
pub async fn deactivate_online(key: &str, activation_id: &str) -> Result<(), String> {
    let client = reqwest::Client::new();
    let max_attempts = 3_u8;
    for attempt in 1..=max_attempts {
        throttle_unauth_polar_request().await;
        let resp = client
            .post(POLAR_DEACTIVATE_URL)
            .json(&serde_json::json!({
                "key": key,
                "organization_id": POLAR_ORG_ID,
                "activation_id": activation_id,
            }))
            .send()
            .await
            .map_err(|e| format!("Network error: {}", e))?;

        if resp.status().is_success() {
            return Ok(());
        }

        if resp.status() == StatusCode::TOO_MANY_REQUESTS {
            let retry_after_secs = parse_retry_after_seconds(&resp).unwrap_or(2);
            if attempt < max_attempts {
                log::warn!(
                    "Polar deactivation rate-limited (429). Retrying in {}s (attempt {}/{})",
                    retry_after_secs,
                    attempt,
                    max_attempts
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(retry_after_secs)).await;
                continue;
            }
            return Err(format!(
                "Deactivation rate-limited by Polar (429). Please wait {} seconds and try again.",
                retry_after_secs
            ));
        }

        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if body.is_empty() {
            return Err(format!("Deactivation failed: {}", status));
        }
        return Err(format!("Deactivation failed ({}): {}", status, body));
    }

    Err("Deactivation failed after retries".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    #[test]
    fn test_trial_not_expired() {
        let cache = LicenseCache {
            license_key: None,
            activation_id: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: Utc::now(),
            trial_expires: Utc::now() + ChronoDuration::days(14),
            seats_used: None,
            seats_limit: None,
            device_name: None,
            customer_name: None,
            customer_email: None,
            customer_avatar_url: None,
        };
        assert!(!is_trial_expired(&cache));
    }

    #[test]
    fn test_trial_expired() {
        let cache = LicenseCache {
            license_key: None,
            activation_id: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: Utc::now() - ChronoDuration::days(15),
            trial_expires: Utc::now() - ChronoDuration::days(1),
            seats_used: None,
            seats_limit: None,
            device_name: None,
            customer_name: None,
            customer_email: None,
            customer_avatar_url: None,
        };
        assert!(is_trial_expired(&cache));
    }

    #[test]
    fn test_grace_period_valid() {
        let cache = LicenseCache {
            license_key: Some("key".to_string()),
            activation_id: Some("act-123".to_string()),
            status: LicenseStatus::Pro,
            licensed_version: Some(1),
            device_id: "test".to_string(),
            activated_at: Some(Utc::now()),
            last_validated: Some(Utc::now() - ChronoDuration::hours(12)),
            trial_started: Utc::now() - ChronoDuration::days(30),
            trial_expires: Utc::now() - ChronoDuration::days(16),
            seats_used: None,
            seats_limit: None,
            device_name: None,
            customer_name: None,
            customer_email: None,
            customer_avatar_url: None,
        };
        assert!(is_within_grace_period(&cache));
    }

    #[test]
    fn test_grace_period_expired() {
        let cache = LicenseCache {
            license_key: Some("key".to_string()),
            activation_id: Some("act-123".to_string()),
            status: LicenseStatus::Pro,
            licensed_version: Some(1),
            device_id: "test".to_string(),
            activated_at: Some(Utc::now()),
            last_validated: Some(Utc::now() - ChronoDuration::hours(25)),
            trial_started: Utc::now() - ChronoDuration::days(30),
            trial_expires: Utc::now() - ChronoDuration::days(16),
            seats_used: None,
            seats_limit: None,
            device_name: None,
            customer_name: None,
            customer_email: None,
            customer_avatar_url: None,
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
            activation_id: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: Utc::now() - ChronoDuration::days(4),
            trial_expires: Utc::now() + ChronoDuration::days(10),
            seats_used: None,
            seats_limit: None,
            device_name: None,
            customer_name: None,
            customer_email: None,
            customer_avatar_url: None,
        };
        let days = trial_days_left(&cache);
        assert!(days >= 9 && days <= 10);
    }

    #[test]
    fn test_parse_validate_response_supports_live_polar_shape() {
        let raw = r#"{
            "status":"granted",
            "user":{"email":"walterlow88@gmail.com","public_name":"w","avatar_url":null},
            "customer":{"email":"walterlow88@gmail.com","name":null,"avatar_url":"https://example.com/avatar.png"},
            "limit_activations":2,
            "usage":0,
            "activation":{"id":"act-123","label":"DESKTOP-9V6CAA5","meta":{"device_id":"abc"}}
        }"#;

        let info = parse_validate_response(raw, StatusCode::OK).unwrap();

        assert!(info.valid);
        assert_eq!(info.seats_limit, Some(2));
        assert_eq!(info.device_name.as_deref(), Some("DESKTOP-9V6CAA5"));
        assert_eq!(info.customer_name.as_deref(), Some("w"));
        assert_eq!(
            info.customer_email.as_deref(),
            Some("walterlow88@gmail.com")
        );
        assert_eq!(
            info.customer_avatar_url.as_deref(),
            Some("https://example.com/avatar.png")
        );
    }

    #[test]
    fn test_parse_validate_response_supports_boolean_valid_shape() {
        let raw = r#"{
            "valid":true,
            "limit_activations":3,
            "usage":1,
            "customer":{"email":"owner@example.com","name":"Owner Example","avatar_url":null},
            "activation":{"id":"act-456","label":"WORKSTATION","meta":{"device_id":"abc"}}
        }"#;

        let info = parse_validate_response(raw, StatusCode::OK).unwrap();

        assert!(info.valid);
        assert_eq!(info.seats_limit, Some(3));
        assert_eq!(info.seats_used, Some(1));
        assert_eq!(info.device_name.as_deref(), Some("WORKSTATION"));
        assert_eq!(info.customer_name.as_deref(), Some("Owner Example"));
        assert_eq!(info.customer_email.as_deref(), Some("owner@example.com"));
    }
}
