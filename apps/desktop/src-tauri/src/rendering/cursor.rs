//! Cursor interpolation utilities for rendering.

// Allow unused fields - kept for potential future use
#![allow(dead_code)]

use super::coord::{Coord, FrameSpace, ScreenUVSpace, Size, ZoomedFrameSpace};
use super::zoom::InterpolatedZoom;
use crate::commands::video_recording::cursor::events::{
    CursorEvent, CursorEventType, CursorImage, CursorRecording, WindowsCursorShape,
};
use crate::commands::video_recording::video_project::CursorConfig;
use std::collections::HashMap;

// ============================================================================
// Spring Physics Configuration
// ============================================================================

/// Spring configuration for cursor movement.
#[derive(Debug, Clone, Copy)]
struct SpringConfig {
    tension: f32,  // Spring stiffness
    mass: f32,     // Object mass
    friction: f32, // Damping coefficient
}

/// Default spring configuration (tuned for smooth cursor following).
const DEFAULT_SPRING: SpringConfig = SpringConfig {
    tension: 180.0,
    mass: 1.0,
    friction: 26.0,
};

/// Snappy profile - used within 160ms of a click (quick response).
fn snappy_spring(base_spring: SpringConfig) -> SpringConfig {
    SpringConfig {
        tension: base_spring.tension * 1.65,
        mass: (base_spring.mass * 0.65).max(0.1),
        friction: base_spring.friction * 1.25,
    }
}

/// Drag profile - used when mouse button is held down (less bouncy).
fn drag_spring(base_spring: SpringConfig) -> SpringConfig {
    SpringConfig {
        tension: base_spring.tension * 1.25,
        mass: (base_spring.mass * 0.85).max(0.1),
        friction: base_spring.friction * 1.1,
    }
}

fn spring_from_cursor_config(_config: &CursorConfig) -> SpringConfig {
    DEFAULT_SPRING
}

/// Maximum allowed lag distance between smoothed and raw cursor positions.
/// Values are in normalized 0-1 cursor coordinate space.
fn resolve_max_lag_distance(_config: &CursorConfig) -> f32 {
    0.022
}

/// Time window for snappy response after click.
const CLICK_REACTION_WINDOW_MS: u64 = 160;

/// Simulation tick rate (60fps internal).
const SIMULATION_TICK_MS: f32 = 1000.0 / 60.0;

/// Gap interpolation threshold - densify if gap is larger than this.
const GAP_INTERPOLATION_THRESHOLD_MS: f32 = SIMULATION_TICK_MS * 4.0;

/// Minimum cursor travel distance for interpolation (2% of screen).
const MIN_CURSOR_TRAVEL_FOR_INTERPOLATION: f32 = 0.02;

/// Maximum interpolated steps to insert.
const MAX_INTERPOLATED_STEPS: usize = 120;

// ============================================================================
// Cursor Idle Fade-Out (from Cap)
// ============================================================================

// ============================================================================
// Cursor Click Animation (from Cap)
// ============================================================================

/// Duration of the click animation (seconds).
const CURSOR_CLICK_DURATION: f64 = 0.25;

/// Duration of the click animation (ms).
const CURSOR_CLICK_DURATION_MS: f64 = CURSOR_CLICK_DURATION * 1000.0;

/// Scale factor when cursor is "shrunk" during click (0.7 = 30% smaller).
const CLICK_SHRINK_SIZE: f32 = 0.7;

// ============================================================================
// Motion Blur Configuration (aligned with Cap)
// ============================================================================

/// Number of samples for motion blur effect.
/// Higher sample count improves trail smoothness.
const MOTION_BLUR_SAMPLES: usize = 32;

/// Baseline trail sample count from the previous 20-sample implementation.
/// Used to normalize trail brightness as sample count changes.
const MOTION_BLUR_BASE_TRAIL_SAMPLES: f32 = 19.0;

/// Minimum velocity (normalized units/frame) to trigger motion blur.
/// Below this threshold, no blur is applied.
const MOTION_BLUR_MIN_VELOCITY: f32 = 0.005;

/// Velocity where blur reaches full strength ramp (smoothstep end).
const MOTION_BLUR_VELOCITY_RAMP_END: f32 = 0.03;

/// Maximum trail length as fraction of frame diagonal.
/// Limits how far back the motion blur trail extends.
const MOTION_BLUR_MAX_TRAIL: f32 = 0.15;

/// Max effective user blur amount (15%).
const MOTION_BLUR_MAX_USER_AMOUNT: f32 = 0.15;

/// Velocity multiplier for trail length calculation.
/// Higher values = longer trails for same velocity.
const MOTION_BLUR_VELOCITY_SCALE: f32 = 2.0;

/// Maximum motion in pixels before clamping (from Cap).
const MAX_MOTION_PIXELS: f32 = 320.0;

/// Minimum motion threshold in normalized coords (from Cap).
const MIN_MOTION_THRESHOLD: f32 = 0.01;

// ============================================================================
// Cursor Scaling Configuration (aligned with Cap)
// ============================================================================

/// Standard cursor height baseline for scaling (from Cap).
const STANDARD_CURSOR_HEIGHT: f32 = 200.0;

// ============================================================================
// Click Animation Functions (from Cap)
// ============================================================================

/// Smooth interpolation function (f32 version for click animation).
fn smoothstep(low: f32, high: f32, v: f32) -> f32 {
    let t = f32::clamp((v - low) / (high - low), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Get click animation progress (0-1).
///
/// Returns a value that can be used to animate the cursor during clicks:
/// - 0.0 = button is pressed (cursor should shrink to CLICK_SHRINK_SIZE)
/// - 1.0 = normal state (no click happening)
/// - Values in between = animating from/to click
fn get_click_t(events: &[CursorEvent], time_ms: u64) -> f32 {
    // Filter to click events only
    let clicks: Vec<_> = events
        .iter()
        .filter(|e| matches!(e.event_type, CursorEventType::LeftClick { .. }))
        .collect();

    if clicks.len() < 2 {
        return 1.0;
    }

    let time = time_ms as f64;

    // Find the click event just before current time
    let mut prev_i = None;
    for (i, pair) in clicks.windows(2).enumerate() {
        let left = pair[0];
        let right = pair[1];

        if (left.timestamp_ms as f64) <= time && (right.timestamp_ms as f64) > time {
            prev_i = Some(i);
            break;
        }
    }

    let Some(prev_i) = prev_i else {
        return 1.0;
    };

    let prev = clicks[prev_i];

    // Check if button is currently pressed
    if let CursorEventType::LeftClick { pressed: true } = prev.event_type {
        return 0.0;
    }

    // Check if we're in the release animation window
    if let CursorEventType::LeftClick { pressed: false } = prev.event_type {
        let time_since_release = time - prev.timestamp_ms as f64;
        if time_since_release <= CURSOR_CLICK_DURATION_MS {
            return smoothstep(
                0.0,
                CURSOR_CLICK_DURATION_MS as f32,
                time_since_release as f32,
            );
        }
    }

    // Check if we're approaching a press event
    if let Some(next) = clicks.get(prev_i + 1) {
        if let CursorEventType::LeftClick { pressed: true } = next.event_type {
            let time_until_press = next.timestamp_ms as f64 - time;
            if time_until_press <= CURSOR_CLICK_DURATION_MS && time_until_press >= 0.0 {
                return smoothstep(
                    0.0,
                    CURSOR_CLICK_DURATION_MS as f32,
                    time_until_press as f32,
                );
            }
        }
    }

    1.0
}

/// Calculate cursor scale based on click state.
///
/// Returns a scale factor (0.7-1.0) based on click animation progress.
fn get_cursor_click_scale(events: &[CursorEvent], time_ms: u64) -> f32 {
    let t = get_click_t(events, time_ms);
    // Interpolate between CLICK_SHRINK_SIZE (0.7) and 1.0
    CLICK_SHRINK_SIZE + (1.0 - CLICK_SHRINK_SIZE) * t
}

// ============================================================================
// Types
// ============================================================================

/// 2D position.
#[derive(Debug, Clone, Copy, Default)]
struct XY {
    x: f32,
    y: f32,
}

/// Pre-computed smoothed cursor event.
#[derive(Debug, Clone)]
struct SmoothedCursorEvent {
    time_ms: u64,
    target_position: XY,
    position: XY,
    velocity: XY,
    spring_config: SpringConfig,
}

/// Interpolated cursor state at a point in time.
#[derive(Debug, Clone)]
pub struct InterpolatedCursor {
    /// Normalized position (0-1).
    pub x: f32,
    pub y: f32,
    /// Velocity for motion blur effects.
    pub velocity_x: f32,
    pub velocity_y: f32,
    /// Active cursor image ID (references cursor_images map).
    pub cursor_id: Option<String>,
    /// Detected cursor shape (for SVG rendering).
    pub cursor_shape: Option<WindowsCursorShape>,
    /// Opacity (0-1) based on idle fade-out.
    pub opacity: f32,
    /// Scale factor (0.7-1.0) based on click animation.
    pub scale: f32,
}

impl Default for InterpolatedCursor {
    fn default() -> Self {
        Self {
            x: 0.5,
            y: 0.5,
            velocity_x: 0.0,
            velocity_y: 0.0,
            cursor_id: None,
            cursor_shape: None,
            opacity: 1.0,
            scale: 1.0,
        }
    }
}

impl InterpolatedCursor {
    /// Get position as a normalized UV coordinate.
    pub fn as_uv_coord(&self) -> Coord<ScreenUVSpace> {
        Coord::new(self.x as f64, self.y as f64)
    }

    /// Convert normalized position to frame space coordinates.
    ///
    /// # Arguments
    /// * `frame_size` - Size of the output frame in pixels
    pub fn to_frame_space(&self, frame_size: Size<FrameSpace>) -> Coord<FrameSpace> {
        Coord::new(
            self.x as f64 * frame_size.width,
            self.y as f64 * frame_size.height,
        )
    }

    /// Convert to zoomed frame space, applying zoom transformation.
    ///
    /// # Arguments
    /// * `frame_size` - Size of the output frame in pixels
    /// * `zoom` - Current interpolated zoom state
    /// * `padding` - Frame padding offset
    pub fn to_zoomed_frame_space(
        &self,
        frame_size: Size<FrameSpace>,
        zoom: &InterpolatedZoom,
        padding: Coord<FrameSpace>,
    ) -> Coord<ZoomedFrameSpace> {
        let frame_pos = self.to_frame_space(frame_size);
        frame_pos.apply_zoom_bounds(zoom, frame_size, padding)
    }

    /// Get velocity as a frame space coordinate (for motion blur).
    pub fn velocity_in_frame_space(&self, frame_size: Size<FrameSpace>) -> Coord<FrameSpace> {
        Coord::new(
            self.velocity_x as f64 * frame_size.width,
            self.velocity_y as f64 * frame_size.height,
        )
    }
}

// ============================================================================
// Spring Physics Simulation
// ============================================================================

/// Spring-mass-damper simulation for smooth cursor movement.
struct SpringSimulation {
    tension: f32,
    mass: f32,
    friction: f32,
    position: XY,
    velocity: XY,
    target_position: XY,
}

impl SpringSimulation {
    fn new(config: SpringConfig) -> Self {
        Self {
            tension: config.tension,
            mass: config.mass,
            friction: config.friction,
            position: XY::default(),
            velocity: XY::default(),
            target_position: XY::default(),
        }
    }

    fn set_config(&mut self, config: SpringConfig) {
        self.tension = config.tension;
        self.mass = config.mass;
        self.friction = config.friction;
    }

    fn set_position(&mut self, pos: XY) {
        self.position = pos;
    }

    fn set_velocity(&mut self, vel: XY) {
        self.velocity = vel;
    }

    fn set_target_position(&mut self, target: XY) {
        self.target_position = target;
    }

    /// Run simulation for given duration.
    /// Uses fixed timestep internally for stability.
    fn run(&mut self, dt_ms: f32) -> XY {
        if dt_ms <= 0.0 {
            return self.position;
        }

        let mut remaining = dt_ms;

        while remaining > 0.0 {
            let step_ms = remaining.min(SIMULATION_TICK_MS);
            let tick = step_ms / 1000.0;

            // Spring force: F = -k * (position - target)
            let dx = self.target_position.x - self.position.x;
            let dy = self.target_position.y - self.position.y;

            let spring_force_x = dx * self.tension;
            let spring_force_y = dy * self.tension;

            // Damping force: F = -c * velocity
            let damping_force_x = -self.velocity.x * self.friction;
            let damping_force_y = -self.velocity.y * self.friction;

            // Total force
            let total_force_x = spring_force_x + damping_force_x;
            let total_force_y = spring_force_y + damping_force_y;

            // Acceleration: a = F / m
            let mass = self.mass.max(0.001);
            let accel_x = total_force_x / mass;
            let accel_y = total_force_y / mass;

            // Update velocity and position
            self.velocity.x += accel_x * tick;
            self.velocity.y += accel_y * tick;
            self.position.x += self.velocity.x * tick;
            self.position.y += self.velocity.y * tick;

            remaining -= step_ms;
        }

        self.position
    }
}

// ============================================================================
// Cursor Interpolator
// ============================================================================

/// Debounce duration for cursor shape changes (matches editor).
const CURSOR_SHAPE_DEBOUNCE_MS: u64 = 80;

/// Cursor interpolator for raw cursor movement.
pub struct CursorInterpolator {
    /// Raw move events from the recording.
    raw_move_events: Vec<CursorEvent>,
    /// Original events for cursor ID lookup.
    original_events: Vec<CursorEvent>,
    /// Cursor images keyed by ID.
    cursor_images: HashMap<String, CursorImage>,
    /// Decoded cursor images (RGBA data).
    decoded_images: HashMap<String, DecodedCursorImage>,
    /// Fallback cursor ID (first available cursor in the recording).
    fallback_cursor_id: Option<String>,
    /// Fallback cursor shape (most common shape found in cursor_images).
    /// Used when cursor_id points to an image without a detected shape.
    fallback_cursor_shape: Option<WindowsCursorShape>,
    /// Pre-computed stable cursor shapes with debouncing applied.
    /// Each entry is (timestamp_ms, shape) - shape is valid from this timestamp until next entry.
    stable_cursor_timeline: Vec<(u64, WindowsCursorShape)>,
    /// Region dimensions (for reference).
    width: u32,
    height: u32,
    /// Offset between recording start and first video frame.
    /// Cursor event lookups must apply this to match frontend preview timing.
    video_start_offset_ms: u64,
}

/// Decoded cursor image ready for compositing.
#[derive(Debug, Clone)]
pub struct DecodedCursorImage {
    pub width: u32,
    pub height: u32,
    pub hotspot_x: i32,
    pub hotspot_y: i32,
    pub data: Vec<u8>, // RGBA
}

impl CursorInterpolator {
    /// Create a new cursor interpolator from a recording.
    pub fn new(recording: &CursorRecording, _cursor_config: &CursorConfig) -> Self {
        let raw_move_events: Vec<CursorEvent> = recording
            .events
            .iter()
            .filter(|e| matches!(e.event_type, CursorEventType::Move))
            .cloned()
            .collect();

        // Decode cursor images from base64 PNG
        let decoded_images = decode_cursor_images(&recording.cursor_images);

        // Find fallback cursor_id (first available in the recording)
        // This ensures cursor is always rendered even if cursor_id is lost
        let fallback_cursor_id = recording.cursor_images.keys().next().cloned();

        // Find fallback cursor shape (most common shape found in cursor_images)
        // This provides consistent cursor rendering when shape detection was spotty during recording
        let fallback_cursor_shape = {
            let mut shape_counts: HashMap<WindowsCursorShape, usize> = HashMap::new();
            for img in recording.cursor_images.values() {
                if let Some(shape) = img.cursor_shape {
                    *shape_counts.entry(shape).or_insert(0) += 1;
                }
            }
            // Get the most common shape
            shape_counts
                .into_iter()
                .max_by_key(|(_, count)| *count)
                .map(|(shape, _)| shape)
        };

        if let Some(ref shape) = fallback_cursor_shape {
            log::info!("[CURSOR] Using fallback cursor shape: {:?}", shape);
        }

        // Pre-compute stable cursor timeline with debouncing
        let stable_cursor_timeline = compute_stable_cursor_timeline(
            &recording.events,
            &recording.cursor_images,
            fallback_cursor_shape,
        );

        log::info!(
            "[CURSOR] Computed {} stable cursor shape transitions",
            stable_cursor_timeline.len()
        );

        Self {
            raw_move_events,
            original_events: recording.events.clone(),
            cursor_images: recording.cursor_images.clone(),
            decoded_images,
            fallback_cursor_id,
            fallback_cursor_shape,
            stable_cursor_timeline,
            width: recording.width,
            height: recording.height,
            video_start_offset_ms: recording.video_start_offset_ms,
        }
    }

    /// Get interpolated cursor position at a specific timestamp.
    ///
    /// This returns the cursor position along with:
    /// - `cursor_id`: Active cursor image ID (with fallback)
    /// - `cursor_shape`: Debounced cursor shape for SVG rendering (prevents flickering)
    pub fn get_cursor_at(&self, time_ms: u64) -> InterpolatedCursor {
        // Apply video start offset to align cursor timestamps with video frame timestamps.
        let adjusted_time_ms = time_ms.saturating_add(self.video_start_offset_ms);

        let cursor_id = get_active_cursor_id(&self.original_events, adjusted_time_ms);
        let mut cursor =
            interpolate_raw_at_time(&self.raw_move_events, adjusted_time_ms, cursor_id);

        // Use fallback cursor_id if none found (prevents cursor from disappearing)
        if cursor.cursor_id.is_none() {
            cursor.cursor_id = self.fallback_cursor_id.clone();
        }

        // Use pre-computed stable cursor shape (with debouncing applied)
        // This prevents rapid flickering between cursor shapes
        cursor.cursor_shape =
            get_stable_cursor_shape(&self.stable_cursor_timeline, adjusted_time_ms);

        // Use fallback cursor_shape if stable timeline didn't have a shape
        if cursor.cursor_shape.is_none() {
            cursor.cursor_shape = self.fallback_cursor_shape;
        }

        // Opacity and scale are always 1.0
        cursor.opacity = 1.0;
        cursor.scale = 1.0;

        cursor
    }

    /// Get decoded cursor image by ID.
    pub fn get_cursor_image(&self, cursor_id: &str) -> Option<&DecodedCursorImage> {
        self.decoded_images.get(cursor_id)
    }

    /// Get cursor image metadata by ID.
    pub fn get_cursor_image_meta(&self, cursor_id: &str) -> Option<&CursorImage> {
        self.cursor_images.get(cursor_id)
    }

    /// Check if there is any cursor data.
    pub fn has_cursor_data(&self) -> bool {
        !self.raw_move_events.is_empty()
    }

    /// Get region dimensions.
    pub fn region_dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/// Get position as XY from a cursor event (events already have normalized 0-1 coords).
fn get_normalized_position(event: &CursorEvent) -> XY {
    XY {
        x: event.x as f32,
        y: event.y as f32,
    }
}

/// Check if we should fill the gap between two cursor events.
fn should_fill_gap(from: &CursorEvent, to: &CursorEvent) -> bool {
    let dt_ms = (to.timestamp_ms as i64 - from.timestamp_ms as i64) as f32;
    if dt_ms < GAP_INTERPOLATION_THRESHOLD_MS {
        return false;
    }

    let from_pos = get_normalized_position(from);
    let to_pos = get_normalized_position(to);

    let dx = to_pos.x - from_pos.x;
    let dy = to_pos.y - from_pos.y;
    let distance = (dx * dx + dy * dy).sqrt();

    distance >= MIN_CURSOR_TRAVEL_FOR_INTERPOLATION
}

/// Densify cursor moves by inserting interpolated samples for large gaps.
fn densify_cursor_moves(events: &[CursorEvent], _recording: &CursorRecording) -> Vec<CursorEvent> {
    if events.len() < 2 {
        return events.to_vec();
    }

    let moves: Vec<_> = events
        .iter()
        .filter(|e| matches!(e.event_type, CursorEventType::Move))
        .collect();

    if moves.len() < 2 {
        return events.to_vec();
    }

    let requires_interpolation = moves.windows(2).any(|w| should_fill_gap(w[0], w[1]));

    if !requires_interpolation {
        return events.to_vec();
    }

    let mut dense_moves: Vec<CursorEvent> = vec![moves[0].clone()];

    for i in 0..moves.len() - 1 {
        let current = moves[i];
        let next = moves[i + 1];

        if should_fill_gap(current, next) {
            let dt_ms = (next.timestamp_ms - current.timestamp_ms) as f32;
            let segments =
                ((dt_ms / SIMULATION_TICK_MS).ceil() as usize).clamp(2, MAX_INTERPOLATED_STEPS);

            for step in 1..segments {
                let t = step as f32 / segments as f32;
                let t_f64 = t as f64;
                dense_moves.push(CursorEvent {
                    timestamp_ms: current.timestamp_ms + (dt_ms * t) as u64,
                    x: current.x + (next.x - current.x) * t_f64,
                    y: current.y + (next.y - current.y) * t_f64,
                    event_type: CursorEventType::Move,
                    // Preserve cursor_id from current event to avoid cursor disappearing
                    cursor_id: current.cursor_id.clone(),
                });
            }
        }

        dense_moves.push(next.clone());
    }

    dense_moves
}

/// Get spring profile based on click context.
fn get_spring_profile(
    time_ms: u64,
    clicks: &[&CursorEvent],
    is_primary_button_down: bool,
    base_spring: SpringConfig,
) -> SpringConfig {
    let recent_click = clicks.iter().find(|c| {
        let diff = time_ms.abs_diff(c.timestamp_ms);
        diff <= CLICK_REACTION_WINDOW_MS
    });

    if recent_click.is_some() {
        return snappy_spring(base_spring);
    }

    if is_primary_button_down {
        return drag_spring(base_spring);
    }

    base_spring
}

/// Pre-compute smoothed cursor events for the entire recording.
fn compute_smoothed_events(
    recording: &CursorRecording,
    base_spring: SpringConfig,
) -> Vec<SmoothedCursorEvent> {
    let moves = densify_cursor_moves(&recording.events, recording);
    let clicks: Vec<_> = recording
        .events
        .iter()
        .filter(|e| {
            matches!(
                e.event_type,
                CursorEventType::LeftClick { .. }
                    | CursorEventType::RightClick { .. }
                    | CursorEventType::MiddleClick { .. }
            )
        })
        .collect();

    if moves.is_empty() {
        return Vec::new();
    }

    let mut sim = SpringSimulation::new(base_spring);
    let mut events: Vec<SmoothedCursorEvent> = Vec::with_capacity(moves.len() + 1);

    let mut primary_button_down = false;
    let mut click_index = 0;

    // Initialize at first position (events already have normalized coords)
    let first_pos = get_normalized_position(&moves[0]);
    sim.set_position(first_pos);
    sim.set_velocity(XY::default());

    let mut last_time_ms = 0u64;

    // Add initial event if there's time before first move
    if moves[0].timestamp_ms > 0 {
        events.push(SmoothedCursorEvent {
            time_ms: 0,
            target_position: first_pos,
            position: first_pos,
            velocity: XY::default(),
            spring_config: base_spring,
        });
    }

    for i in 0..moves.len() {
        let mov = &moves[i];
        let target_pos = get_normalized_position(mov);

        // Look ahead for next target
        let next_target = if i + 1 < moves.len() {
            get_normalized_position(&moves[i + 1])
        } else {
            target_pos
        };

        sim.set_target_position(next_target);

        // Update click state
        while click_index < clicks.len() && clicks[click_index].timestamp_ms <= mov.timestamp_ms {
            if let CursorEventType::LeftClick { pressed } = clicks[click_index].event_type {
                primary_button_down = pressed;
            }
            click_index += 1;
        }

        // Get appropriate spring profile
        let profile =
            get_spring_profile(mov.timestamp_ms, &clicks, primary_button_down, base_spring);
        sim.set_config(profile);

        // Run simulation
        let dt = (mov.timestamp_ms - last_time_ms) as f32;
        sim.run(dt);
        last_time_ms = mov.timestamp_ms;

        events.push(SmoothedCursorEvent {
            time_ms: mov.timestamp_ms,
            target_position: next_target,
            position: sim.position,
            velocity: sim.velocity,
            spring_config: profile,
        });
    }

    events
}

/// Find the active cursor ID at a given timestamp.
fn get_active_cursor_id(events: &[CursorEvent], time_ms: u64) -> Option<String> {
    let mut active_cursor_id: Option<String> = None;

    for event in events {
        if event.timestamp_ms > time_ms {
            break;
        }
        if event.cursor_id.is_some() {
            active_cursor_id = event.cursor_id.clone();
        }
    }

    active_cursor_id
}

/// Compute stable cursor shape timeline with debouncing.
///
/// This prevents rapid flickering between cursor shapes (e.g., arrow ↔ resize)
/// by requiring a shape to persist for CURSOR_SHAPE_DEBOUNCE_MS before committing.
fn compute_stable_cursor_timeline(
    events: &[CursorEvent],
    cursor_images: &HashMap<String, CursorImage>,
    fallback_shape: Option<WindowsCursorShape>,
) -> Vec<(u64, WindowsCursorShape)> {
    let mut timeline: Vec<(u64, WindowsCursorShape)> = Vec::new();

    // Track debouncing state
    let mut stable_shape: Option<WindowsCursorShape> = fallback_shape;
    let mut pending_shape: Option<WindowsCursorShape> = None;
    let mut pending_since: u64 = 0;

    // Get shape for a cursor ID
    let get_shape = |cursor_id: &Option<String>| -> Option<WindowsCursorShape> {
        cursor_id
            .as_ref()
            .and_then(|id| cursor_images.get(id))
            .and_then(|img| img.cursor_shape)
            .or(fallback_shape)
    };

    for event in events {
        let current_shape = get_shape(&event.cursor_id);

        // Skip if no shape detected
        let Some(shape) = current_shape else {
            continue;
        };

        // If shape matches stable, reset pending
        if Some(shape) == stable_shape {
            pending_shape = None;
            continue;
        }

        // If shape matches pending, check if debounce period passed
        if Some(shape) == pending_shape {
            if event.timestamp_ms >= pending_since + CURSOR_SHAPE_DEBOUNCE_MS {
                // Debounce complete - promote to stable
                stable_shape = Some(shape);
                timeline.push((pending_since + CURSOR_SHAPE_DEBOUNCE_MS, shape));
                pending_shape = None;
            }
            continue;
        }

        // New shape detected - start debounce timer
        pending_shape = Some(shape);
        pending_since = event.timestamp_ms;

        // If no stable shape yet, use this one immediately
        if stable_shape.is_none() {
            stable_shape = Some(shape);
            timeline.push((event.timestamp_ms, shape));
            pending_shape = None;
        }
    }

    // If timeline is empty but we have a fallback, add it at time 0
    if timeline.is_empty() {
        if let Some(shape) = fallback_shape {
            timeline.push((0, shape));
        }
    }

    timeline
}

/// Look up stable cursor shape at a given timestamp.
fn get_stable_cursor_shape(
    timeline: &[(u64, WindowsCursorShape)],
    time_ms: u64,
) -> Option<WindowsCursorShape> {
    if timeline.is_empty() {
        return None;
    }

    // Find the last entry at or before time_ms
    let mut result = timeline[0].1;
    for (ts, shape) in timeline {
        if *ts > time_ms {
            break;
        }
        result = *shape;
    }
    Some(result)
}

/// Interpolate smoothed position at a specific timestamp.
fn interpolate_at_time(
    events: &[SmoothedCursorEvent],
    time_ms: u64,
    cursor_id: Option<String>,
) -> InterpolatedCursor {
    if events.is_empty() {
        return InterpolatedCursor {
            cursor_id,
            ..Default::default()
        };
    }

    // Before first event
    if time_ms <= events[0].time_ms {
        let e = &events[0];
        return InterpolatedCursor {
            x: e.position.x,
            y: e.position.y,
            velocity_x: e.velocity.x,
            velocity_y: e.velocity.y,
            cursor_id,
            cursor_shape: None, // Will be set by get_cursor_at
            opacity: 1.0,       // Will be set by get_cursor_at
            scale: 1.0,         // Will be set by get_cursor_at
        };
    }

    // After last event
    let last = &events[events.len() - 1];
    if time_ms >= last.time_ms {
        return InterpolatedCursor {
            x: last.position.x,
            y: last.position.y,
            velocity_x: last.velocity.x,
            velocity_y: last.velocity.y,
            cursor_id,
            cursor_shape: None,
            opacity: 1.0,
            scale: 1.0,
        };
    }

    // Find surrounding events and interpolate
    for i in 0..events.len() - 1 {
        let curr = &events[i];
        let next = &events[i + 1];

        if time_ms >= curr.time_ms && time_ms < next.time_ms {
            // Continue simulation from curr to exact time
            let mut sim = SpringSimulation::new(curr.spring_config);
            sim.set_position(curr.position);
            sim.set_velocity(curr.velocity);
            sim.set_target_position(curr.target_position);

            let dt = (time_ms - curr.time_ms) as f32;
            sim.run(dt);

            return InterpolatedCursor {
                x: sim.position.x,
                y: sim.position.y,
                velocity_x: sim.velocity.x,
                velocity_y: sim.velocity.y,
                cursor_id,
                cursor_shape: None,
                opacity: 1.0,
                scale: 1.0,
            };
        }
    }

    // Fallback
    InterpolatedCursor {
        x: last.position.x,
        y: last.position.y,
        velocity_x: last.velocity.x,
        velocity_y: last.velocity.y,
        cursor_id,
        cursor_shape: None,
        opacity: 1.0,
        scale: 1.0,
    }
}

fn segment_velocity(curr: &CursorEvent, next: &CursorEvent) -> XY {
    let dt_ms = (next.timestamp_ms.saturating_sub(curr.timestamp_ms)).max(1) as f32;
    let dt_seconds = dt_ms / 1000.0;
    XY {
        x: ((next.x - curr.x) as f32) / dt_seconds,
        y: ((next.y - curr.y) as f32) / dt_seconds,
    }
}

fn interpolate_raw_at_time(
    move_events: &[CursorEvent],
    time_ms: u64,
    cursor_id: Option<String>,
) -> InterpolatedCursor {
    if move_events.is_empty() {
        return InterpolatedCursor {
            cursor_id,
            ..Default::default()
        };
    }

    // Before first event
    if time_ms <= move_events[0].timestamp_ms {
        let first = &move_events[0];
        let velocity = move_events
            .get(1)
            .map(|next| segment_velocity(first, next))
            .unwrap_or_default();
        return InterpolatedCursor {
            x: first.x as f32,
            y: first.y as f32,
            velocity_x: velocity.x,
            velocity_y: velocity.y,
            cursor_id,
            cursor_shape: None,
            opacity: 1.0,
            scale: 1.0,
        };
    }

    // After last event
    let last = &move_events[move_events.len() - 1];
    if time_ms >= last.timestamp_ms {
        let velocity = move_events
            .get(move_events.len().saturating_sub(2))
            .map(|prev| segment_velocity(prev, last))
            .unwrap_or_default();
        return InterpolatedCursor {
            x: last.x as f32,
            y: last.y as f32,
            velocity_x: velocity.x,
            velocity_y: velocity.y,
            cursor_id,
            cursor_shape: None,
            opacity: 1.0,
            scale: 1.0,
        };
    }

    // Between two move events: linear interpolation with segment velocity
    for i in 0..move_events.len() - 1 {
        let curr = &move_events[i];
        let next = &move_events[i + 1];
        if time_ms >= curr.timestamp_ms && time_ms < next.timestamp_ms {
            let dt_ms = (next.timestamp_ms.saturating_sub(curr.timestamp_ms)).max(1);
            let t = (time_ms.saturating_sub(curr.timestamp_ms)) as f32 / dt_ms as f32;
            let velocity = segment_velocity(curr, next);
            return InterpolatedCursor {
                x: (curr.x + (next.x - curr.x) * t as f64) as f32,
                y: (curr.y + (next.y - curr.y) * t as f64) as f32,
                velocity_x: velocity.x,
                velocity_y: velocity.y,
                cursor_id,
                cursor_shape: None,
                opacity: 1.0,
                scale: 1.0,
            };
        }
    }

    InterpolatedCursor {
        x: last.x as f32,
        y: last.y as f32,
        velocity_x: 0.0,
        velocity_y: 0.0,
        cursor_id,
        cursor_shape: None,
        opacity: 1.0,
        scale: 1.0,
    }
}

fn apply_lag_compensation(
    mut smoothed: InterpolatedCursor,
    raw: &InterpolatedCursor,
    max_lag_distance: f32,
) -> InterpolatedCursor {
    if max_lag_distance <= 0.0 {
        return smoothed;
    }

    let dx = raw.x - smoothed.x;
    let dy = raw.y - smoothed.y;
    let distance = (dx * dx + dy * dy).sqrt();

    if distance <= max_lag_distance || distance == 0.0 {
        return smoothed;
    }

    let correction_t = (distance - max_lag_distance) / distance;
    smoothed.x += dx * correction_t;
    smoothed.y += dy * correction_t;
    smoothed.velocity_x += (raw.velocity_x - smoothed.velocity_x) * correction_t;
    smoothed.velocity_y += (raw.velocity_y - smoothed.velocity_y) * correction_t;
    smoothed
}

/// Decode cursor images from base64 PNG to RGBA.
fn decode_cursor_images(
    cursor_images: &HashMap<String, CursorImage>,
) -> HashMap<String, DecodedCursorImage> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use image::ImageReader;
    use std::io::Cursor;

    let mut decoded = HashMap::new();

    for (id, img) in cursor_images {
        // Decode base64 to PNG bytes
        let png_bytes = match STANDARD.decode(&img.data_base64) {
            Ok(bytes) => bytes,
            Err(e) => {
                log::warn!("[CURSOR] Failed to decode base64 for cursor {}: {}", id, e);
                continue;
            },
        };

        // Decode PNG to RGBA
        let reader = match ImageReader::new(Cursor::new(&png_bytes)).with_guessed_format() {
            Ok(r) => r,
            Err(e) => {
                log::warn!("[CURSOR] Failed to read cursor image {}: {}", id, e);
                continue;
            },
        };

        let image = match reader.decode() {
            Ok(img) => img.to_rgba8(),
            Err(e) => {
                log::warn!("[CURSOR] Failed to decode cursor image {}: {}", id, e);
                continue;
            },
        };

        decoded.insert(
            id.clone(),
            DecodedCursorImage {
                width: image.width(),
                height: image.height(),
                hotspot_x: img.hotspot_x,
                hotspot_y: img.hotspot_y,
                data: image.into_raw(),
            },
        );

        log::debug!(
            "[CURSOR] Decoded cursor image: {} ({}x{}, hotspot: {},{})",
            id,
            img.width,
            img.height,
            img.hotspot_x,
            img.hotspot_y
        );
    }

    decoded
}

/// Calculate aspect-ratio aware cursor scale (like Cap).
///
/// Prevents wide cursors from becoming excessively large by basing
/// the scale on width for wide cursors and height for normal cursors.
///
/// # Arguments
/// * `cursor_width` - Cursor image width in pixels
/// * `cursor_height` - Cursor image height in pixels
/// * `output_height` - Output frame height in pixels
/// * `user_scale` - User-configured cursor size (0-100, where 100 = 100%)
pub fn calculate_aspect_aware_scale(
    cursor_width: u32,
    cursor_height: u32,
    output_height: u32,
    user_scale: f32,
) -> f32 {
    let texture_aspect = cursor_width as f32 / cursor_height.max(1) as f32;

    // Base size calculation (like Cap)
    let base_size = STANDARD_CURSOR_HEIGHT / output_height as f32;

    // User scale factor (user_scale is 0-100, convert to multiplier)
    let user_factor = user_scale / 100.0;

    // For wide cursors (aspect > 1), base scaling on width to prevent excess
    // For normal cursors, base scaling on height
    let scale = if texture_aspect > 1.0 {
        // Wide cursor - use width-based scaling
        base_size * user_factor / texture_aspect
    } else {
        // Normal cursor - use height-based scaling
        base_size * user_factor
    };

    scale.max(0.1) // Ensure minimum scale
}

/// Video content bounds within the composition frame.
/// Used to correctly position cursor when padding is applied.
#[derive(Debug, Clone, Copy)]
pub struct VideoContentBounds {
    /// X offset of video content within composition
    pub x: f32,
    /// Y offset of video content within composition
    pub y: f32,
    /// Width of video content area
    pub width: f32,
    /// Height of video content area
    pub height: f32,
}

impl VideoContentBounds {
    /// Create bounds where video fills the entire frame (no padding).
    pub fn full_frame(frame_width: u32, frame_height: u32) -> Self {
        Self {
            x: 0.0,
            y: 0.0,
            width: frame_width as f32,
            height: frame_height as f32,
        }
    }

    /// Create bounds with padding (video centered within composition).
    pub fn with_padding(
        _composition_width: u32,
        _composition_height: u32,
        video_width: u32,
        video_height: u32,
        padding: u32,
    ) -> Self {
        // In auto mode, video is centered with padding on all sides
        // frame_x = padding, frame_y = padding
        // frame_width = video_width, frame_height = video_height
        Self {
            x: padding as f32,
            y: padding as f32,
            width: video_width as f32,
            height: video_height as f32,
        }
    }
}

/// Sample a cursor texture with bilinear filtering.
fn sample_cursor_bilinear(cursor_image: &DecodedCursorImage, src_x: f32, src_y: f32) -> [f32; 4] {
    let width = cursor_image.width as i32;
    let height = cursor_image.height as i32;

    if width <= 0 || height <= 0 {
        return [0.0, 0.0, 0.0, 0.0];
    }

    let clamped_x = src_x.clamp(0.0, (width - 1) as f32);
    let clamped_y = src_y.clamp(0.0, (height - 1) as f32);

    let x0 = clamped_x.floor() as i32;
    let y0 = clamped_y.floor() as i32;
    let x1 = (x0 + 1).min(width - 1);
    let y1 = (y0 + 1).min(height - 1);

    let tx = clamped_x - x0 as f32;
    let ty = clamped_y - y0 as f32;

    let sample = |x: i32, y: i32| -> [f32; 4] {
        let idx = ((y as u32 * cursor_image.width + x as u32) * 4) as usize;
        if idx + 3 >= cursor_image.data.len() {
            return [0.0, 0.0, 0.0, 0.0];
        }
        [
            cursor_image.data[idx] as f32,
            cursor_image.data[idx + 1] as f32,
            cursor_image.data[idx + 2] as f32,
            cursor_image.data[idx + 3] as f32,
        ]
    };

    let p00 = sample(x0, y0);
    let p10 = sample(x1, y0);
    let p01 = sample(x0, y1);
    let p11 = sample(x1, y1);

    let mut out = [0.0_f32; 4];
    for channel in 0..4 {
        let top = p00[channel] * (1.0 - tx) + p10[channel] * tx;
        let bottom = p01[channel] * (1.0 - tx) + p11[channel] * tx;
        out[channel] = top * (1.0 - ty) + bottom * ty;
    }

    out
}

/// Composite cursor image onto frame (CPU-based).
///
/// Uses the cursor's opacity and scale properties for idle fade-out and click animation.
/// The `base_scale` parameter allows additional scaling on top of the cursor's animated scale.
/// Supports premultiplied alpha for SVG cursors (like Cap).
///
/// # Arguments
/// * `frame_data` - Mutable reference to frame RGBA data
/// * `frame_width` - Frame width in pixels (full composition including padding)
/// * `frame_height` - Frame height in pixels (full composition including padding)
/// * `video_bounds` - Bounds of video content within the frame (for cursor positioning)
/// * `cursor` - Interpolated cursor position (normalized 0-1) with opacity and scale
/// * `cursor_image` - Decoded cursor image
/// * `base_scale` - Base cursor scale factor (1.0 = native size), multiplied with cursor.scale
pub fn composite_cursor(
    frame_data: &mut [u8],
    frame_width: u32,
    frame_height: u32,
    video_bounds: &VideoContentBounds,
    cursor: &InterpolatedCursor,
    cursor_image: &DecodedCursorImage,
    base_scale: f32,
) {
    // Skip if cursor is fully transparent
    if cursor.opacity <= 0.0 {
        return;
    }

    // Combine base scale with click animation scale
    let scale = base_scale * cursor.scale;
    if scale <= 0.0 {
        return;
    }

    // Convert normalized position to pixel position within video content area,
    // then offset by video bounds to position correctly within composition
    let pixel_x = video_bounds.x + cursor.x * video_bounds.width;
    let pixel_y = video_bounds.y + cursor.y * video_bounds.height;

    // Apply hotspot offset and scale
    let draw_x = pixel_x - (cursor_image.hotspot_x as f32 * scale);
    let draw_y = pixel_y - (cursor_image.hotspot_y as f32 * scale);

    let scaled_width = cursor_image.width as f32 * scale;
    let scaled_height = cursor_image.height as f32 * scale;
    if scaled_width <= 0.0 || scaled_height <= 0.0 {
        return;
    }

    let min_x = draw_x.floor().max(0.0) as i32;
    let min_y = draw_y.floor().max(0.0) as i32;
    let max_x = (draw_x + scaled_width).ceil().min(frame_width as f32) as i32;
    let max_y = (draw_y + scaled_height).ceil().min(frame_height as f32) as i32;

    if min_x >= max_x || min_y >= max_y {
        return;
    }

    // Alpha blending with premultiplied alpha support.
    // Use bilinear filtering for smoother cursor edges during scale and motion blur trails.
    for dst_y in min_y..max_y {
        for dst_x in min_x..max_x {
            let src_x = ((dst_x as f32 + 0.5) - draw_x) / scale - 0.5;
            let src_y = ((dst_y as f32 + 0.5) - draw_y) / scale - 0.5;

            if src_x < 0.0
                || src_y < 0.0
                || src_x > (cursor_image.width as f32 - 1.0)
                || src_y > (cursor_image.height as f32 - 1.0)
            {
                continue;
            }

            let [src_r, src_g, src_b, src_a] = sample_cursor_bilinear(cursor_image, src_x, src_y);

            if src_a <= 0.0 {
                continue;
            }

            let dst_idx = ((dst_y as u32 * frame_width + dst_x as u32) * 4) as usize;
            if dst_idx + 3 >= frame_data.len() {
                continue;
            }

            // For premultiplied alpha blending:
            // result = src + dst * (1 - src_alpha)
            // Where src is already premultiplied by its alpha.
            let alpha = (src_a / 255.0) * cursor.opacity;
            let inv_alpha = 1.0 - alpha;

            // Source is premultiplied, so we multiply by opacity, not full alpha.
            frame_data[dst_idx] = ((src_r * cursor.opacity)
                + (frame_data[dst_idx] as f32 * inv_alpha))
                .min(255.0) as u8;
            frame_data[dst_idx + 1] = ((src_g * cursor.opacity)
                + (frame_data[dst_idx + 1] as f32 * inv_alpha))
                .min(255.0) as u8;
            frame_data[dst_idx + 2] = ((src_b * cursor.opacity)
                + (frame_data[dst_idx + 2] as f32 * inv_alpha))
                .min(255.0) as u8;
            // Keep destination alpha (frame_data[dst_idx + 3]).
        }
    }
}

/// Composite cursor with motion blur effect onto frame (CPU-based).
///
/// Renders a trail of semi-transparent cursor copies behind the main cursor
/// based on velocity. Uses smoothstep easing for smooth weight distribution
/// like Cap's GPU implementation.
///
/// # Arguments
/// * `frame_data` - Mutable reference to frame RGBA data
/// * `frame_width` - Frame width in pixels (full composition including padding)
/// * `frame_height` - Frame height in pixels (full composition including padding)
/// * `video_bounds` - Bounds of video content within the frame (for cursor positioning)
/// * `cursor` - Interpolated cursor position with velocity
/// * `cursor_image` - Decoded cursor image
/// * `base_scale` - Base cursor scale factor
/// * `motion_blur_amount` - User-configured blur amount (0.0 = disabled, 1.0 = max)
pub fn composite_cursor_with_motion_blur(
    frame_data: &mut [u8],
    frame_width: u32,
    frame_height: u32,
    video_bounds: &VideoContentBounds,
    cursor: &InterpolatedCursor,
    cursor_image: &DecodedCursorImage,
    base_scale: f32,
    motion_blur_amount: f32,
) {
    let motion_blur_amount = motion_blur_amount.clamp(0.0, MOTION_BLUR_MAX_USER_AMOUNT);
    if motion_blur_amount <= 0.0 {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    // Calculate velocity magnitude (in normalized units)
    let velocity_magnitude =
        (cursor.velocity_x * cursor.velocity_x + cursor.velocity_y * cursor.velocity_y).sqrt();

    // If velocity is below threshold, just render normally without blur
    if velocity_magnitude < MOTION_BLUR_MIN_VELOCITY {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    // Smoothly ramp in blur strength with speed to avoid abrupt/stiff trails.
    let velocity_factor = smoothstep(
        MOTION_BLUR_MIN_VELOCITY,
        MOTION_BLUR_VELOCITY_RAMP_END,
        velocity_magnitude,
    );
    if velocity_factor <= 0.0 {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    // Calculate motion in pixels and clamp to max (like Cap)
    let frame_diagonal = ((frame_width * frame_width + frame_height * frame_height) as f32).sqrt();
    let motion_pixels = velocity_magnitude * frame_diagonal * MOTION_BLUR_VELOCITY_SCALE;
    let clamped_motion = motion_pixels.min(MAX_MOTION_PIXELS);

    // Convert back to normalized trail length and apply user intensity.
    let trail_length = ((clamped_motion / frame_diagonal).min(MOTION_BLUR_MAX_TRAIL))
        * motion_blur_amount
        * velocity_factor;
    if trail_length < MIN_MOTION_THRESHOLD {
        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor,
            cursor_image,
            base_scale,
        );
        return;
    }

    // Normalize velocity direction
    let dir_x = -cursor.velocity_x / velocity_magnitude;
    let dir_y = -cursor.velocity_y / velocity_magnitude;
    let trail_sample_count = (MOTION_BLUR_SAMPLES.saturating_sub(1)) as f32;
    let weight_normalization = if trail_sample_count > 0.0 {
        MOTION_BLUR_BASE_TRAIL_SAMPLES / trail_sample_count
    } else {
        1.0
    };

    // Render trail samples from back to front (excluding the main cursor sample).
    // Main cursor is rendered once at full opacity after the trail.
    for i in (1..MOTION_BLUR_SAMPLES).rev() {
        let t = i as f32 / (MOTION_BLUR_SAMPLES - 1) as f32;

        // Use smoothstep easing for smooth deceleration (like Cap's GPU shader)
        let eased_t = smoothstep(0.0, 1.0, t);

        // Position along the trail (0 = current position, 1 = trail end)
        let offset_x = dir_x * trail_length * eased_t;
        let offset_y = dir_y * trail_length * eased_t;

        // Weight distribution like Cap: weight = 1.0 - t * 0.75
        // This creates smoother falloff than our previous 0.85
        let weight = (1.0 - t * 0.75) * motion_blur_amount * velocity_factor * weight_normalization;
        if weight <= 0.0 {
            continue;
        }

        // Create a modified cursor for this trail sample
        let trail_cursor = InterpolatedCursor {
            x: cursor.x + offset_x,
            y: cursor.y + offset_y,
            velocity_x: cursor.velocity_x,
            velocity_y: cursor.velocity_y,
            cursor_id: cursor.cursor_id.clone(),
            cursor_shape: cursor.cursor_shape,
            opacity: cursor.opacity * weight,
            scale: cursor.scale,
        };

        composite_cursor(
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            &trail_cursor,
            cursor_image,
            base_scale,
        );
    }

    // Render main cursor on top at full opacity.
    composite_cursor(
        frame_data,
        frame_width,
        frame_height,
        video_bounds,
        cursor,
        cursor_image,
        base_scale,
    );
}

/// Get an SVG cursor as a DecodedCursorImage if the shape is known.
///
/// This allows using SVG cursors with the existing composite functions.
/// Returns None if the shape is not recognized or SVG rendering fails.
///
/// # Arguments
/// * `shape` - The Windows cursor shape
/// * `target_height` - Target height in pixels (used for scaling)
pub fn get_svg_cursor_image(
    shape: crate::commands::video_recording::cursor::events::WindowsCursorShape,
    target_height: u32,
) -> Option<DecodedCursorImage> {
    use super::svg_cursor::render_svg_cursor;

    let scale = target_height as f32 / 24.0;
    let rendered = render_svg_cursor(shape, scale)?;

    Some(DecodedCursorImage {
        width: rendered.width,
        height: rendered.height,
        hotspot_x: rendered.hotspot_x,
        hotspot_y: rendered.hotspot_y,
        data: rendered.data,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_recording() -> CursorRecording {
        CursorRecording {
            sample_rate: 100,
            width: 1920,
            height: 1080,
            region_x: 0,
            region_y: 0,
            video_start_offset_ms: 0,
            events: vec![
                CursorEvent {
                    timestamp_ms: 0,
                    x: 0.0,
                    y: 0.5,
                    event_type: CursorEventType::Move,
                    cursor_id: None,
                },
                CursorEvent {
                    timestamp_ms: 200,
                    x: 1.0,
                    y: 0.5,
                    event_type: CursorEventType::Move,
                    cursor_id: None,
                },
                CursorEvent {
                    timestamp_ms: 400,
                    x: 1.0,
                    y: 0.5,
                    event_type: CursorEventType::Move,
                    cursor_id: None,
                },
            ],
            cursor_images: HashMap::new(),
        }
    }

    #[test]
    fn test_spring_simulation() {
        let mut sim = SpringSimulation::new(DEFAULT_SPRING);
        sim.set_position(XY { x: 0.0, y: 0.0 });
        sim.set_target_position(XY { x: 1.0, y: 1.0 });

        // Run simulation for 1 second
        sim.run(1000.0);

        // Position should be close to target
        assert!((sim.position.x - 1.0).abs() < 0.1);
        assert!((sim.position.y - 1.0).abs() < 0.1);
    }

    #[test]
    fn test_interpolated_cursor_default() {
        let cursor = InterpolatedCursor::default();
        assert_eq!(cursor.x, 0.5);
        assert_eq!(cursor.y, 0.5);
        assert_eq!(cursor.velocity_x, 0.0);
        assert_eq!(cursor.velocity_y, 0.0);
        assert!(cursor.cursor_id.is_none());
    }

    #[test]
    fn test_cursor_interpolator_uses_raw_interpolation() {
        let recording = test_recording();

        let raw_interp = CursorInterpolator::new(&recording, &CursorConfig::default());
        let raw_cursor = raw_interp.get_cursor_at(100);
        assert!((raw_cursor.x - 0.5).abs() < 0.05);
    }

    #[test]
    fn test_cursor_interpolator_is_deterministic() {
        let recording = test_recording();

        let interp = CursorInterpolator::new(&recording, &CursorConfig::default());
        let a = interp.get_cursor_at(120);
        let b = interp.get_cursor_at(120);

        assert!((a.x - b.x).abs() < 0.0001);
        assert!((a.y - b.y).abs() < 0.0001);
        assert!((a.velocity_x - b.velocity_x).abs() < 0.0001);
        assert!((a.velocity_y - b.velocity_y).abs() < 0.0001);
    }

    #[test]
    fn test_cursor_interpolator_applies_video_start_offset() {
        let mut recording = test_recording();
        recording.video_start_offset_ms = 100;

        let interp = CursorInterpolator::new(&recording, &CursorConfig::default());

        // With 100ms offset applied, querying at t=0 should match raw event stream at t=100.
        let cursor = interp.get_cursor_at(0);
        assert!((cursor.x - 0.5).abs() < 0.05);
    }
}
