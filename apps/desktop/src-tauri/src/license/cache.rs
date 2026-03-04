//! Encrypted license cache.
//!
//! Stores license state on disk using AES-256-GCM encryption.

use aes_gcm::{aead::Aead, aead::KeyInit, aead::OsRng, AeadCore, Aes256Gcm, Nonce};
use std::path::Path;

use super::types::LicenseCache;

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::license::types::LicenseStatus;
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
