//! Machine fingerprint generation.
//!
//! Creates a stable, deterministic device identifier from machine characteristics.

use sha2::{Digest, Sha256};
use std::env;

/// Generate a deterministic device ID from machine characteristics.
pub fn generate_device_id() -> String {
    let mut hasher = Sha256::new();

    if let Ok(name) = env::var("COMPUTERNAME") {
        hasher.update(name.as_bytes());
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(guid) = get_windows_machine_guid() {
            hasher.update(guid.as_bytes());
        }
    }

    if let Ok(user) = env::var("USERNAME") {
        hasher.update(user.as_bytes());
    }

    let result = hasher.finalize();
    hex::encode(&result[..16])
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
    for line in stdout.lines() {
        if line.contains("MachineGuid") {
            return line.split_whitespace().last().map(|s| s.to_string());
        }
    }
    None
}

/// Derive a 32-byte AES-256 encryption key from the device ID.
pub fn derive_encryption_key(device_id: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"moonsnap-license-v1-");
    hasher.update(device_id.as_bytes());
    let result = hasher.finalize();
    result.into()
}

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
