//! Tauri commands for the licensing system.

use parking_lot::RwLock;
use std::path::PathBuf;
use std::sync::{Arc, OnceLock};
use std::time::{Duration as StdDuration, Instant};
use tokio::sync::Mutex;

use crate::license::{
    cache, device, feature_gate, validation, ActivationResult, LicenseCache, LicenseInfo,
    LicenseStatus,
};

const CACHE_FILENAME: &str = "license.dat";
const TRIAL_DAYS: i64 = 7;
const PROFILE_BACKFILL_MIN_INTERVAL: StdDuration = StdDuration::from_secs(30);
static PROFILE_BACKFILL_GATE: OnceLock<Mutex<Instant>> = OnceLock::new();

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
                activation_id: None,
                status: LicenseStatus::Trial,
                licensed_version: None,
                device_id: device_id.clone(),
                activated_at: None,
                last_validated: None,
                trial_started: now,
                trial_expires: now + chrono::Duration::days(TRIAL_DAYS),
                seats_used: None,
                seats_limit: None,
                device_name: None,
                customer_name: None,
                customer_email: None,
                customer_avatar_url: None,
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

async fn validate_and_refresh_cache(
    key: &str,
    activation_id: Option<&str>,
) -> Option<validation::ValidationInfo> {
    // Polar activation metadata can be briefly unavailable right after activate.
    // Retry a few times so seat/device info appears immediately in UI.
    let mut last_error: Option<String> = None;
    for attempt in 0..3 {
        match validation::validate_online(key, activation_id).await {
            Ok(info) => {
                if info.seats_used.is_none()
                    || info.seats_limit.is_none()
                    || info.device_name.is_none()
                {
                    log::warn!(
                        "Polar validate returned incomplete metadata (seats_used={:?}, seats_limit={:?}, device_name={:?}, activation_id_present={})",
                        info.seats_used,
                        info.seats_limit,
                        info.device_name,
                        activation_id.is_some()
                    );
                }
                return Some(info);
            },
            Err(e) => {
                last_error = Some(e);
                if attempt < 2 {
                    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;
                }
            },
        }
    }

    if let Some(err) = last_error {
        log::warn!("License validation refresh failed after retries: {}", err);
    }
    None
}

async fn should_attempt_profile_backfill() -> bool {
    let gate = PROFILE_BACKFILL_GATE
        .get_or_init(|| Mutex::new(Instant::now() - PROFILE_BACKFILL_MIN_INTERVAL));
    let mut last_attempt = gate.lock().await;
    if last_attempt.elapsed() < PROFILE_BACKFILL_MIN_INTERVAL {
        return false;
    }

    *last_attempt = Instant::now();
    true
}

async fn backfill_pro_profile_if_missing(state: &LicenseState) {
    let (key, activation_id) = {
        let guard = state.cache.read();
        let Some(cache) = guard.as_ref() else {
            return;
        };

        let missing_profile = cache.customer_name.is_none()
            && cache.customer_email.is_none()
            && cache.device_name.is_none()
            && cache.seats_limit.is_none();

        if cache.status != LicenseStatus::Pro || !missing_profile {
            return;
        }

        let Some(key) = cache.license_key.clone() else {
            return;
        };

        (key, cache.activation_id.clone())
    };

    if !should_attempt_profile_backfill().await {
        return;
    }

    match validation::validate_online(&key, activation_id.as_deref()).await {
        Ok(info) if info.valid => {
            let mut guard = state.cache.write();
            if let Some(ref mut cache) = *guard {
                if cache.license_key.as_deref() != Some(key.as_str()) {
                    return;
                }

                cache.last_validated = Some(chrono::Utc::now());
                cache.seats_used = info.seats_used;
                cache.seats_limit = info.seats_limit;
                cache.device_name = info.device_name;
                cache.customer_name = info.customer_name;
                cache.customer_email = info.customer_email;
                cache.customer_avatar_url = info.customer_avatar_url;

                if let Err(e) = cache::save_cache(&state.cache_path, &state.encryption_key, cache) {
                    log::error!("Failed to save backfilled license profile: {}", e);
                }
            }
        },
        Ok(_) => {
            let mut guard = state.cache.write();
            if let Some(ref mut cache) = *guard {
                if cache.license_key.as_deref() != Some(key.as_str()) {
                    return;
                }

                cache.status = LicenseStatus::Expired;
                if let Err(e) = cache::save_cache(&state.cache_path, &state.encryption_key, cache) {
                    log::error!(
                        "Failed to save expired license state after profile refresh: {}",
                        e
                    );
                }
            }
        },
        Err(e) => {
            log::warn!("License profile backfill skipped: {}", e);
        },
    }
}

#[tauri::command]
pub async fn get_license_status(
    state: tauri::State<'_, LicenseState>,
) -> Result<LicenseInfo, String> {
    backfill_pro_profile_if_missing(&state).await;

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
        seats_used: cache.seats_used,
        seats_limit: cache.seats_limit,
        device_name: cache.device_name.clone(),
        customer_name: cache.customer_name.clone(),
        customer_email: cache.customer_email.clone(),
        customer_avatar_url: cache.customer_avatar_url.clone(),
    })
}

#[tauri::command]
pub async fn activate_license(
    key: String,
    state: tauri::State<'_, LicenseState>,
) -> Result<ActivationResult, String> {
    let device_id = state.device_id.clone();
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "unknown".to_string());

    let online_result = validation::activate_online(&key, &device_id, &hostname).await?;

    if online_result.result.success {
        let activation_id = online_result.activation_id.clone();
        let validation = validate_and_refresh_cache(&key, activation_id.as_deref()).await;
        let now = chrono::Utc::now();

        let mut guard = state.cache.write();
        if let Some(ref mut c) = *guard {
            c.license_key = Some(key);
            c.activation_id = activation_id;
            c.status = LicenseStatus::Pro;
            c.licensed_version = Some(
                app_version()
                    .split('.')
                    .next()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(1),
            );
            c.activated_at = Some(now);
            // Activation succeeded online; start 24h revalidation window now.
            c.last_validated = Some(now);
            c.seats_used = None;
            c.seats_limit = None;
            c.device_name = None;
            c.customer_name = None;
            c.customer_email = None;
            c.customer_avatar_url = None;
            if let Some(ref info) = validation {
                c.seats_used = info.seats_used;
                c.seats_limit = info.seats_limit;
                c.device_name = info.device_name.clone();
                c.customer_name = info.customer_name.clone();
                c.customer_email = info.customer_email.clone();
                c.customer_avatar_url = info.customer_avatar_url.clone();
            }

            if let Err(e) = cache::save_cache(&state.cache_path, &state.encryption_key, c) {
                log::error!("Failed to save license cache: {}", e);
            }
        }
    }

    Ok(online_result.result)
}

#[tauri::command]
pub async fn deactivate_license(state: tauri::State<'_, LicenseState>) -> Result<(), String> {
    let (key, activation_id) = {
        let guard = state.cache.read();
        let cache = guard.as_ref().ok_or("License not initialized")?;
        let key = cache
            .license_key
            .as_ref()
            .ok_or("No license key to deactivate")?
            .clone();
        let activation_id = cache.activation_id.clone();
        (key, activation_id)
    };

    // Only call Polar deactivate API if we have an activation_id.
    // Legacy caches from before activation_id tracking just clear locally.
    if let Some(ref act_id) = activation_id {
        validation::deactivate_online(&key, act_id).await?;
    } else {
        log::warn!("No activation_id stored - clearing local cache only");
    }

    let mut guard = state.cache.write();
    if let Some(ref mut c) = *guard {
        c.license_key = None;
        c.activation_id = None;
        c.status = LicenseStatus::Free;
        c.licensed_version = None;
        c.activated_at = None;
        c.last_validated = None;
        c.seats_used = None;
        c.seats_limit = None;
        c.device_name = None;
        c.customer_name = None;
        c.customer_email = None;
        c.customer_avatar_url = None;
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

/// Background task: re-validate license every 24 hours.
///
/// Checks hourly whether the license needs re-validation. If the last
/// validation was more than 24 hours ago, contacts Polar.sh to confirm
/// the license is still valid. On failure, marks the license as expired.
/// Network errors are silently retried on the next hourly tick.
pub async fn background_revalidation(
    cache_state: Arc<RwLock<Option<LicenseCache>>>,
    encryption_key: [u8; 32],
    cache_path: PathBuf,
) {
    loop {
        tokio::time::sleep(tokio::time::Duration::from_secs(3600)).await; // Check hourly

        let needs_validation = {
            let guard = cache_state.read();
            guard.as_ref().is_some_and(|c| {
                if c.status != LicenseStatus::Pro {
                    return false;
                }
                let now = chrono::Utc::now();
                if let Some(last) = c.last_validated {
                    (now - last).num_hours() >= 24
                } else if let Some(activated_at) = c.activated_at {
                    (now - activated_at).num_hours() >= 24
                } else {
                    // Legacy cache without timestamps: validate on next tick.
                    true
                }
            })
        };

        if needs_validation {
            let (key, activation_id) = {
                let guard = cache_state.read();
                guard.as_ref().map_or((None, None), |c| {
                    (c.license_key.clone(), c.activation_id.clone())
                })
            };

            if let Some(key) = key {
                match validation::validate_online(&key, activation_id.as_deref()).await {
                    Ok(info) if info.valid => {
                        let mut guard = cache_state.write();
                        if let Some(ref mut c) = *guard {
                            c.last_validated = Some(chrono::Utc::now());
                            c.seats_used = info.seats_used;
                            c.seats_limit = info.seats_limit;
                            c.device_name = info.device_name;
                            c.customer_name = info.customer_name;
                            c.customer_email = info.customer_email;
                            c.customer_avatar_url = info.customer_avatar_url;
                            let _ = cache::save_cache(&cache_path, &encryption_key, c);
                            log::info!("License re-validated successfully");
                        }
                    },
                    Ok(_) => {
                        let mut guard = cache_state.write();
                        if let Some(ref mut c) = *guard {
                            c.status = LicenseStatus::Expired;
                            let _ = cache::save_cache(&cache_path, &encryption_key, c);
                            log::warn!("License validation failed — key revoked");
                        }
                    },
                    Err(e) => {
                        log::warn!("License re-validation network error (will retry): {}", e);
                    },
                }
            }
        }
    }
}
