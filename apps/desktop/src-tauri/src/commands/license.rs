//! Tauri commands for the licensing system.

use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::Arc;

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

#[tauri::command]
pub async fn activate_license(
    key: String,
    state: tauri::State<'_, LicenseState>,
) -> Result<ActivationResult, String> {
    let device_id = state.device_id.clone();
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());

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

            if let Err(e) = cache::save_cache(&state.cache_path, &state.encryption_key, c) {
                log::error!("Failed to save license cache: {}", e);
            }
        }
    }

    Ok(result)
}

#[tauri::command]
pub async fn deactivate_license(state: tauri::State<'_, LicenseState>) -> Result<(), String> {
    let (key, device_id) = {
        let guard = state.cache.read();
        let cache = guard.as_ref().ok_or("License not initialized")?;
        let key = cache
            .license_key
            .as_ref()
            .ok_or("No license key to deactivate")?
            .clone();
        (key, state.device_id.clone())
    };

    validation::deactivate_online(&key, &device_id).await?;

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

#[tauri::command]
pub fn check_pro_feature(
    feature: String,
    state: tauri::State<'_, LicenseState>,
) -> Result<bool, String> {
    if !feature_gate::is_pro_feature(&feature) {
        return Ok(true);
    }

    let guard = state.cache.read();
    let cache = guard.as_ref().ok_or("License not initialized")?;
    let status = validation::resolve_status(cache, &app_version());
    Ok(feature_gate::require_pro(&status).is_ok())
}
