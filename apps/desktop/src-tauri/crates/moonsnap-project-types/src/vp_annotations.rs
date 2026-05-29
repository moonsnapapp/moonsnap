//! Annotation shapes, segments, and configuration.
//!
//! Split out of `video_project` and re-exported from it (crate-level sibling
//! module to keep ts-rs `export_to` path depth identical).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Annotation Configuration
// ============================================================================

/// Supported annotation shape types.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub enum AnnotationShapeType {
    Rectangle,
    Ellipse,
    #[default]
    Arrow,
    Line,
    Step,
    Text,
}

fn default_annotation_stroke_color() -> String {
    "#F97316".to_string()
}

fn default_annotation_fill_color() -> String {
    "rgba(249, 115, 22, 0.16)".to_string()
}

fn default_annotation_text() -> String {
    "Note".to_string()
}

fn default_annotation_font_family() -> String {
    "sans-serif".to_string()
}

/// A single annotation shape drawn within an annotation segment.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AnnotationShape {
    /// Unique identifier.
    pub id: String,
    /// Shape type.
    #[serde(default)]
    pub shape_type: AnnotationShapeType,
    /// X position (0-1, normalized from left).
    pub x: f32,
    /// Y position (0-1, normalized from top).
    pub y: f32,
    /// Width (0-1, normalized).
    pub width: f32,
    /// Height (0-1, normalized).
    pub height: f32,
    /// Arrow/line start X position (0-1 normalized).
    #[serde(default)]
    pub arrow_start_x: Option<f32>,
    /// Arrow/line start Y position (0-1 normalized).
    #[serde(default)]
    pub arrow_start_y: Option<f32>,
    /// Arrow/line end X position (0-1 normalized).
    #[serde(default)]
    pub arrow_end_x: Option<f32>,
    /// Arrow/line end Y position (0-1 normalized).
    #[serde(default)]
    pub arrow_end_y: Option<f32>,
    /// Stroke color.
    #[serde(default = "default_annotation_stroke_color")]
    pub stroke_color: String,
    /// Fill color for closed shapes.
    #[serde(default = "default_annotation_fill_color")]
    pub fill_color: String,
    /// Stroke width in 1080p reference pixels.
    #[serde(default = "AnnotationShape::default_stroke_width")]
    pub stroke_width: f32,
    /// Opacity multiplier (0-1).
    #[serde(default = "AnnotationShape::default_opacity")]
    pub opacity: f32,
    /// Step number for badge annotations.
    #[serde(default = "AnnotationShape::default_number")]
    pub number: u32,
    /// Text content for text annotations.
    #[serde(default = "default_annotation_text")]
    pub text: String,
    /// Font size in 1080p reference pixels.
    #[serde(default = "AnnotationShape::default_font_size")]
    pub font_size: f32,
    /// Font family for text annotations.
    #[serde(default = "default_annotation_font_family")]
    pub font_family: String,
    /// Font weight for text annotations.
    #[serde(default = "AnnotationShape::default_font_weight")]
    pub font_weight: f32,
}

impl AnnotationShape {
    fn default_stroke_width() -> f32 {
        16.0
    }

    fn default_opacity() -> f32 {
        1.0
    }

    fn default_number() -> u32 {
        1
    }

    fn default_font_size() -> f32 {
        42.0
    }

    fn default_font_weight() -> f32 {
        700.0
    }
}

impl Default for AnnotationShape {
    fn default() -> Self {
        Self {
            id: "annotation-shape".to_string(),
            shape_type: AnnotationShapeType::Arrow,
            x: 0.2,
            y: 0.2,
            width: 0.3,
            height: 0.2,
            arrow_start_x: None,
            arrow_start_y: None,
            arrow_end_x: None,
            arrow_end_y: None,
            stroke_color: default_annotation_stroke_color(),
            fill_color: default_annotation_fill_color(),
            stroke_width: Self::default_stroke_width(),
            opacity: Self::default_opacity(),
            number: Self::default_number(),
            text: default_annotation_text(),
            font_size: Self::default_font_size(),
            font_family: default_annotation_font_family(),
            font_weight: Self::default_font_weight(),
        }
    }
}

/// A timed annotation segment containing one or more shapes.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AnnotationSegment {
    /// Unique identifier for this segment.
    pub id: String,
    /// Start time in milliseconds.
    #[ts(type = "number")]
    pub start_ms: u64,
    /// End time in milliseconds.
    #[ts(type = "number")]
    pub end_ms: u64,
    /// Whether this segment is enabled.
    #[serde(default = "default_annotation_segment_enabled")]
    pub enabled: bool,
    /// Shapes drawn during this segment.
    #[serde(default)]
    pub shapes: Vec<AnnotationShape>,
}

const fn default_annotation_segment_enabled() -> bool {
    true
}

/// Annotation overlay configuration for the video.
#[derive(Debug, Clone, Serialize, Deserialize, TS, Default)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../../src/types/generated/")]
pub struct AnnotationConfig {
    /// Timed annotation segments.
    pub segments: Vec<AnnotationSegment>,
}
