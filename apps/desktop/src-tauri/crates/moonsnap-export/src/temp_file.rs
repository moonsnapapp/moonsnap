//! Temporary-file staging helpers for export adapters.

use std::fs;
use std::path::PathBuf;

/// Stage embedded bytes into a deterministic temp file and return the path.
pub fn stage_embedded_temp_file(file_name: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(file_name);
    fs::write(&path, bytes)
        .map_err(|e| format!("Failed to stage temp file at {}: {}", path.display(), e))?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stages_embedded_bytes_into_temp_file() {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let file_name = format!(
            "moonsnap_export_temp_test_{}_{}.bin",
            std::process::id(),
            unique
        );
        let bytes = b"hello-temp";
        let path = stage_embedded_temp_file(&file_name, bytes).unwrap();

        let written = fs::read(&path).unwrap();
        assert_eq!(written, bytes);

        let _ = fs::remove_file(path);
    }
}
