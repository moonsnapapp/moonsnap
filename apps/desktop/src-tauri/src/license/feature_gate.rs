//! Feature gating for Pro-only functionality.

use super::types::LicenseStatus;

/// Features that require a Pro license.
const PRO_FEATURES: &[&str] = &[
    "video_recording",
    "gif_export",
    "blur_tool",
    "custom_backgrounds",
    "webcam_overlay",
    "high_res_export",
];

/// Check if a feature name requires Pro.
pub fn is_pro_feature(feature: &str) -> bool {
    PRO_FEATURES.contains(&feature)
}

/// Guard: returns Ok(()) if status allows Pro features, Err otherwise.
pub fn require_pro(status: &LicenseStatus) -> Result<(), String> {
    match status {
        LicenseStatus::Pro | LicenseStatus::Trial => Ok(()),
        LicenseStatus::Free => Err(
            "This feature requires MoonSnap Pro. Upgrade at https://buy.polar.sh/polar_cl_WDZB2ld3wEqqWTOustdiNZHASOHMOz4lxlsZ03VjJfx".to_string(),
        ),
        LicenseStatus::Expired => Err(
            "Your license has expired. Please reconnect to the internet to re-validate, or upgrade at https://buy.polar.sh/polar_cl_WDZB2ld3wEqqWTOustdiNZHASOHMOz4lxlsZ03VjJfx".to_string(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pro_features_list() {
        assert!(is_pro_feature("video_recording"));
        assert!(is_pro_feature("gif_export"));
        assert!(is_pro_feature("blur_tool"));
        assert!(is_pro_feature("custom_backgrounds"));
        assert!(is_pro_feature("webcam_overlay"));
        assert!(is_pro_feature("high_res_export"));
    }

    #[test]
    fn test_free_features_not_gated() {
        assert!(!is_pro_feature("screenshot"));
        assert!(!is_pro_feature("basic_annotation"));
        assert!(!is_pro_feature("unknown_feature"));
    }
}
