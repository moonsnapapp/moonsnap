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
    #[serde(rename = "trial")]
    Trial,
    #[serde(rename = "pro")]
    Pro,
    #[serde(rename = "free")]
    Free,
    #[serde(rename = "expired")]
    Expired,
}

/// Encrypted local license cache. Stored on disk, never sent to frontend directly.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseCache {
    pub license_key: Option<String>,
    pub activation_id: Option<String>,
    pub status: LicenseStatus,
    pub licensed_version: Option<u32>,
    pub device_id: String,
    pub activated_at: Option<DateTime<Utc>>,
    pub last_validated: Option<DateTime<Utc>>,
    pub trial_started: DateTime<Utc>,
    pub trial_expires: DateTime<Utc>,
    pub seats_used: Option<u32>,
    pub seats_limit: Option<u32>,
    pub device_name: Option<String>,
}

/// License info exposed to the frontend via Tauri commands.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct LicenseInfo {
    pub status: LicenseStatus,
    pub trial_days_left: Option<i64>,
    pub licensed_version: Option<u32>,
    pub seats_used: Option<u32>,
    pub seats_limit: Option<u32>,
    pub device_name: Option<String>,
}

/// Result of a license activation attempt.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ActivationResult {
    pub success: bool,
    pub message: String,
}

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
            activation_id: None,
            status: LicenseStatus::Trial,
            licensed_version: None,
            device_id: "test-device".to_string(),
            activated_at: None,
            last_validated: None,
            trial_started: chrono::Utc::now(),
            trial_expires: chrono::Utc::now() + chrono::Duration::days(14),
            seats_used: None,
            seats_limit: None,
            device_name: None,
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
            seats_used: None,
            seats_limit: None,
            device_name: None,
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
