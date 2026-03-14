use std::fs;
use tauri::AppHandle;

use super::bundle_utils;

/// Result of migrating project folders to .moonsnap bundles.
pub struct MigrationResult {
    pub migrated: usize,
    pub skipped: usize,
    pub failed: Vec<(String, String)>,
}

/// Core migration logic, testable without AppHandle.
pub fn migrate_captures_dir(
    captures_dir: &std::path::Path,
    projects_dir: Option<&std::path::Path>,
) -> Result<MigrationResult, String> {
    if !captures_dir.exists() {
        return Ok(MigrationResult {
            migrated: 0,
            skipped: 0,
            failed: Vec::new(),
        });
    }

    let mut result = MigrationResult {
        migrated: 0,
        skipped: 0,
        failed: Vec::new(),
    };

    let entries = fs::read_dir(captures_dir)
        .map_err(|e| format!("Failed to read captures directory: {}", e))?;

    for entry in entries.flatten() {
        let path = entry.path();

        if !path.is_dir() {
            continue;
        }

        if path.extension().and_then(|e| e.to_str()) == Some("moonsnap") {
            result.skipped += 1;
            continue;
        }

        if !path.join("screen.mp4").exists() {
            continue;
        }

        let folder_name = match path.file_name().and_then(|n| n.to_str()) {
            Some(name) => name.to_string(),
            None => continue,
        };

        let target = captures_dir.join(format!("{}.moonsnap", folder_name));
        if target.exists() && !target.is_dir() {
            log::info!("[MIGRATION] Removing legacy sidecar: {:?}", target);
            let _ = fs::remove_file(&target);
        }

        match fs::rename(&path, &target) {
            Ok(()) => {
                log::info!("[MIGRATION] Renamed {:?} -> {:?}", path, target);
                bundle_utils::set_hidden_on_bundle_contents(&target);

                if let Some(projects_dir) = projects_dir {
                    migrate_sidecar_dir(&target, &folder_name, projects_dir);
                }

                result.migrated += 1;
            },
            Err(e) => {
                log::warn!("[MIGRATION] Failed to rename {:?}: {}", path, e);
                result.failed.push((folder_name, e.to_string()));
            },
        }
    }

    if result.migrated > 0 || !result.failed.is_empty() {
        log::info!(
            "[MIGRATION] Complete: {} migrated, {} skipped, {} failed",
            result.migrated,
            result.skipped,
            result.failed.len()
        );
    }

    Ok(result)
}

fn migrate_sidecar_dir(
    bundle_path: &std::path::Path,
    old_folder_name: &str,
    projects_dir: &std::path::Path,
) {
    if let Ok(content) = fs::read_to_string(bundle_path.join("project.json")) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
            if let Some(project_id) = parsed.get("id").and_then(|v| v.as_str()) {
                if project_id != old_folder_name {
                    let old_sidecar = projects_dir.join(old_folder_name);
                    let new_sidecar = projects_dir.join(project_id);
                    if old_sidecar.exists() && !new_sidecar.exists() {
                        let _ = fs::rename(&old_sidecar, &new_sidecar);
                        log::info!(
                            "[MIGRATION] Renamed sidecar {:?} -> {:?}",
                            old_sidecar,
                            new_sidecar
                        );
                    }
                }
            }
        }
    }
}

/// Entry point called from lib.rs on startup.
pub fn migrate_to_bundles(app: &AppHandle) -> Result<MigrationResult, String> {
    let captures_dir = super::get_captures_dir(app)?;
    let projects_dir = super::get_app_data_dir(app)
        .map(|d| d.join("projects"))
        .ok();
    migrate_captures_dir(&captures_dir, projects_dir.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_project_folder(dir: &std::path::Path, name: &str) {
        let folder = dir.join(name);
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("screen.mp4"), b"fake video").unwrap();
        fs::write(folder.join("project.json"), r#"{"id":"test123"}"#).unwrap();
    }

    #[test]
    fn test_migrates_bare_folder_to_bundle() {
        let tmp = TempDir::new().unwrap();
        create_project_folder(tmp.path(), "moonsnap_20260314_123456_12345");

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 1);
        assert!(tmp
            .path()
            .join("moonsnap_20260314_123456_12345.moonsnap")
            .exists());
        assert!(!tmp.path().join("moonsnap_20260314_123456_12345").exists());
    }

    #[test]
    fn test_skips_already_migrated_bundles() {
        let tmp = TempDir::new().unwrap();
        create_project_folder(tmp.path(), "moonsnap_20260314_123456_12345.moonsnap");

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
        assert_eq!(result.skipped, 1);
    }

    #[test]
    fn test_skips_non_project_folders() {
        let tmp = TempDir::new().unwrap();
        fs::create_dir_all(tmp.path().join("random_folder")).unwrap();

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
    }

    #[test]
    fn test_removes_legacy_sidecar_before_rename() {
        let tmp = TempDir::new().unwrap();
        create_project_folder(tmp.path(), "moonsnap_20260314_123456_12345");
        fs::write(
            tmp.path().join("moonsnap_20260314_123456_12345.moonsnap"),
            b"legacy sidecar",
        )
        .unwrap();

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 1);
        assert!(tmp
            .path()
            .join("moonsnap_20260314_123456_12345.moonsnap")
            .is_dir());
    }

    #[test]
    fn test_leaves_quick_capture_files_alone() {
        let tmp = TempDir::new().unwrap();
        fs::write(
            tmp.path().join("moonsnap_20260314_123456_12345.mp4"),
            b"video",
        )
        .unwrap();

        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
        assert!(tmp
            .path()
            .join("moonsnap_20260314_123456_12345.mp4")
            .exists());
    }

    #[test]
    fn test_migrates_sidecar_directory() {
        let tmp = TempDir::new().unwrap();
        let captures = tmp.path().join("captures");
        let projects = tmp.path().join("projects");
        fs::create_dir_all(&captures).unwrap();
        fs::create_dir_all(&projects).unwrap();

        let folder = captures.join("moonsnap_20260314_123456_12345");
        fs::create_dir_all(&folder).unwrap();
        fs::write(folder.join("screen.mp4"), b"fake video").unwrap();
        fs::write(folder.join("project.json"), r#"{"id":"abc123def456"}"#).unwrap();

        let old_sidecar = projects.join("moonsnap_20260314_123456_12345");
        fs::create_dir_all(&old_sidecar).unwrap();
        fs::write(old_sidecar.join("project.json"), r#"{"tags":["test"]}"#).unwrap();

        let result = migrate_captures_dir(&captures, Some(&projects)).unwrap();
        assert_eq!(result.migrated, 1);
        assert!(!projects.join("moonsnap_20260314_123456_12345").exists());
        assert!(projects.join("abc123def456").exists());
    }

    #[test]
    fn test_empty_captures_dir() {
        let tmp = TempDir::new().unwrap();
        let result = migrate_captures_dir(tmp.path(), None).unwrap();
        assert_eq!(result.migrated, 0);
        assert_eq!(result.skipped, 0);
        assert!(result.failed.is_empty());
    }
}
