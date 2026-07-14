//! Update operations for project annotations and metadata.

use chrono::Utc;
use moonsnap_error::error::MoonSnapResult;
use std::fs;
use std::path::Path;
use tauri::command;

use super::get_app_data_dir;
use moonsnap_domain::storage::*;

#[command]
pub async fn update_project_annotations(
    app: tauri::AppHandle,
    project_id: String,
    annotations: Vec<Annotation>,
) -> MoonSnapResult<CaptureProject> {
    let base_dir = get_app_data_dir(&app)?;
    let project_file = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    if !project_file.exists() {
        return Err("Project not found".into());
    }

    let content =
        fs::read_to_string(&project_file).map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    project.annotations = annotations;
    project.updated_at = Utc::now();

    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;

    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project: {}", e))?;

    Ok(project)
}

/// Load the metadata sidecar at `projects/{id}/project.json`, apply `apply`,
/// and persist it. When no sidecar exists (e.g. video/GIF items that never had
/// metadata written), a metadata-only sidecar is created first.
pub(crate) fn update_sidecar_metadata(
    base_dir: &Path,
    project_id: &str,
    apply: impl FnOnce(&mut CaptureProject),
) -> MoonSnapResult<CaptureProject> {
    let project_dir = base_dir.join("projects").join(project_id);
    let project_file = project_dir.join("project.json");

    let mut project: CaptureProject = if project_file.exists() {
        let content = fs::read_to_string(&project_file)
            .map_err(|e| format!("Failed to read project: {}", e))?;
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?
    } else {
        // No project.json exists (e.g. legacy media file) — create a
        // metadata-only sidecar in projects/
        fs::create_dir_all(&project_dir)
            .map_err(|e| format!("Failed to create project dir: {}", e))?;

        let now = Utc::now();
        CaptureProject {
            id: project_id.to_string(),
            created_at: now,
            updated_at: now,
            capture_type: "video".to_string(),
            source: CaptureSource {
                monitor: None,
                window_id: None,
                window_title: None,
                region: None,
            },
            original_image: String::new(),
            dimensions: Dimensions {
                width: 0,
                height: 0,
            },
            annotations: Vec::new(),
            tags: Vec::new(),
            favorite: false,
            folder_id: None,
        }
    };

    apply(&mut project);
    project.updated_at = Utc::now();

    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project: {}", e))?;

    Ok(project)
}

#[command]
pub async fn update_project_metadata(
    app: tauri::AppHandle,
    project_id: String,
    tags: Option<Vec<String>>,
    favorite: Option<bool>,
) -> MoonSnapResult<CaptureProject> {
    let base_dir = get_app_data_dir(&app)?;
    update_sidecar_metadata(&base_dir, &project_id, |project| {
        if let Some(t) = tags {
            project.tags = t;
        }
        if let Some(f) = favorite {
            project.favorite = f;
        }
    })
}
