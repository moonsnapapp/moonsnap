//! Update operations for project annotations and metadata.

use chrono::Utc;
use moonsnap_core::error::MoonSnapResult;
use std::fs;
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

#[command]
pub async fn update_project_metadata(
    app: tauri::AppHandle,
    project_id: String,
    tags: Option<Vec<String>>,
    favorite: Option<bool>,
) -> MoonSnapResult<CaptureProject> {
    let base_dir = get_app_data_dir(&app)?;

    // Use projects/{id}/project.json for all metadata
    let projects_path = base_dir
        .join("projects")
        .join(&project_id)
        .join("project.json");

    let project_file = if projects_path.exists() {
        projects_path
    } else {
        // No project.json exists (e.g. legacy media file) — create one in projects/
        let project_dir = base_dir.join("projects").join(&project_id);
        fs::create_dir_all(&project_dir)
            .map_err(|e| format!("Failed to create project dir: {}", e))?;

        let now = Utc::now();
        let project = CaptureProject {
            id: project_id.clone(),
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
            tags: tags.clone().unwrap_or_default(),
            favorite: favorite.unwrap_or(false),
        };

        let json = serde_json::to_string_pretty(&project)
            .map_err(|e| format!("Failed to serialize project: {}", e))?;
        let path = project_dir.join("project.json");
        fs::write(&path, json).map_err(|e| format!("Failed to write project: {}", e))?;

        return Ok(project);
    };

    let content =
        fs::read_to_string(&project_file).map_err(|e| format!("Failed to read project: {}", e))?;

    let mut project: CaptureProject =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse project: {}", e))?;

    if let Some(t) = tags {
        project.tags = t;
    }
    if let Some(f) = favorite {
        project.favorite = f;
    }
    project.updated_at = Utc::now();

    let project_json = serde_json::to_string_pretty(&project)
        .map_err(|e| format!("Failed to serialize project: {}", e))?;
    fs::write(&project_file, project_json)
        .map_err(|e| format!("Failed to write project: {}", e))?;

    Ok(project)
}
