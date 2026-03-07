//! Cursor interpolation utilities for rendering.

// Allow unused fields - kept for potential future use
#![allow(dead_code)]

use crate::commands::video_recording::cursor::events::{
    CursorEvent, CursorEventType, CursorImage, CursorRecording, WindowsCursorShape,
};
use moonsnap_domain::video_project::CursorConfig;
use moonsnap_render::coord::{Coord, FrameSpace, ScreenUVSpace, Size, ZoomedFrameSpace};
use moonsnap_render::cursor_composite::{
    composite_cursor as composite_cursor_shared,
    composite_cursor_with_motion_blur as composite_cursor_with_motion_blur_shared,
    CursorCompositeInput, CursorCompositeState, DecodedCursorImage as SharedDecodedCursorImage,
    VideoContentBounds as SharedVideoContentBounds,
};
use moonsnap_render::zoom::InterpolatedZoom;
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

/// Delay before cursor starts fading out when idle.
const CURSOR_IDLE_TIMEOUT_MS: u64 = 1200;

/// Duration of fade-out once idle timeout has elapsed.
const CURSOR_IDLE_FADE_DURATION_MS: u64 = 300;

/// Ignore tiny move jitter when deciding cursor activity (normalized units).
/// 0.0015 ~= ~3px at 1920px width.
const CURSOR_ACTIVITY_MOVE_DEADZONE: f64 = 0.0015;
const CURSOR_ACTIVITY_MOVE_DEADZONE_SQ: f64 =
    CURSOR_ACTIVITY_MOVE_DEADZONE * CURSOR_ACTIVITY_MOVE_DEADZONE;
const CURSOR_SMOOTHING_MIN_ZOOM: f32 = 1.15;
const CURSOR_SMOOTHING_MAX_ZOOM: f32 = 2.0;
const CURSOR_SMOOTHING_MAX_WINDOW_MS: f64 = 72.0;
const CURSOR_SMOOTHING_MIN_WINDOW_MS: f64 = 12.0;
const CURSOR_SMOOTHING_OVERDRIVE_WINDOW_MS: f64 = 56.0;
const CURSOR_SMOOTHING_SAMPLE_OFFSETS: [f64; 5] = [-1.0, -0.5, 0.0, 0.5, 1.0];
const CURSOR_SMOOTHING_SAMPLE_WEIGHTS: [f32; 5] = [0.12, 0.2, 0.36, 0.2, 0.12];
const CURSOR_SMOOTHING_VELOCITY_DELTA_RATIO: f64 = 0.35;
const CURSOR_SMOOTHING_MIN_VELOCITY_DELTA_MS: f64 = 8.0;
const CURSOR_CATCHUP_RESPONSE_START: f32 = 0.0025;
const CURSOR_CATCHUP_RESPONSE_END: f32 = 0.045;
const CURSOR_CATCHUP_BASE_STRENGTH: f32 = 0.3;
const CURSOR_CATCHUP_OVERDRIVE_STRENGTH: f32 = 0.18;

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
    /// Region dimensions (for reference).
    width: u32,
    height: u32,
    /// Offset between recording start and first video frame.
    /// Cursor event lookups must apply this to match frontend preview timing.
    video_start_offset_ms: u64,
    /// Whether inactivity fade-out is enabled in cursor settings.
    hide_when_idle: bool,
    /// Zoom-adaptive smoothing strength (0 = linear, 1 = smooth).
    dampening: f32,
    /// Timestamps for cursor activity events (move/click/scroll), sorted ascending.
    /// Used for inactivity fade-out opacity.
    activity_timestamps: Vec<u64>,
}

/// Decoded cursor image ready for compositing.
pub type DecodedCursorImage = SharedDecodedCursorImage;

impl CursorInterpolator {
    /// Create a new cursor interpolator from a recording.
    pub fn new(recording: &CursorRecording, cursor_config: &CursorConfig) -> Self {
        let raw_move_events: Vec<CursorEvent> = recording
            .events
            .iter()
            .filter(|e| matches!(e.event_type, CursorEventType::Move))
            .cloned()
            .collect();

        let mut activity_timestamps = collect_activity_timestamps(&recording.events);
        activity_timestamps.sort_unstable();
        activity_timestamps.dedup();

        // Decode cursor images from base64 PNG
        let decoded_images = decode_cursor_images(&recording.cursor_images);

        // Match frontend preview fallback cursor-id strategy:
        // 1) cursor_0, 2) first arrow-shaped image, 3) stable first key.
        let fallback_cursor_id = if recording.cursor_images.contains_key("cursor_0") {
            Some("cursor_0".to_string())
        } else if let Some((id, _)) = recording
            .cursor_images
            .iter()
            .find(|(_, img)| img.cursor_shape == Some(WindowsCursorShape::Arrow))
        {
            Some(id.clone())
        } else {
            let mut keys: Vec<&String> = recording.cursor_images.keys().collect();
            keys.sort();
            keys.first().map(|k| (*k).clone())
        };

        Self {
            raw_move_events,
            original_events: recording.events.clone(),
            cursor_images: recording.cursor_images.clone(),
            decoded_images,
            fallback_cursor_id,
            width: recording.width,
            height: recording.height,
            video_start_offset_ms: recording.video_start_offset_ms,
            hide_when_idle: cursor_config.hide_when_idle,
            dampening: cursor_config.dampening.clamp(0.0, 2.0),
            activity_timestamps,
        }
    }

    /// Get interpolated cursor position at a specific timestamp.
    ///
    /// This returns the cursor position along with:
    /// - `cursor_id`: Active cursor image ID (with preview-matching fallback)
    /// - `cursor_shape`: Shape from active cursor image, falling back to Arrow
    pub fn get_cursor_at(&self, time_ms: u64, zoom_scale: f32) -> InterpolatedCursor {
        // Apply video start offset to align cursor timestamps with video frame timestamps.
        let adjusted_time_ms = time_ms.saturating_add(self.video_start_offset_ms);

        let cursor_id = get_active_cursor_id(&self.original_events, adjusted_time_ms);
        let mut cursor = interpolate_cursor_at_time(
            &self.raw_move_events,
            adjusted_time_ms as f64,
            cursor_id,
            zoom_scale,
            self.dampening,
        );

        // Use fallback cursor_id if none found (prevents cursor from disappearing)
        if cursor.cursor_id.is_none() {
            cursor.cursor_id = self.fallback_cursor_id.clone();
        }

        // Match frontend preview behavior:
        // derive shape from the active cursor image, fallback to Arrow when shape is missing.
        cursor.cursor_shape = cursor
            .cursor_id
            .as_ref()
            .and_then(|id| self.cursor_images.get(id))
            .and_then(|img| img.cursor_shape)
            .or_else(|| {
                if cursor.cursor_id.is_some() {
                    Some(WindowsCursorShape::Arrow)
                } else {
                    None
                }
            });

        // Fade cursor out after inactivity.
        cursor.opacity = if self.hide_when_idle {
            get_cursor_idle_opacity(&self.activity_timestamps, adjusted_time_ms)
        } else {
            1.0
        };
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

fn collect_activity_timestamps(events: &[CursorEvent]) -> Vec<u64> {
    let mut activity_timestamps = Vec::new();
    let mut last_significant_move: Option<(f64, f64)> = None;

    for event in events {
        match event.event_type {
            CursorEventType::Move => {
                let should_count_move = if let Some((last_x, last_y)) = last_significant_move {
                    let dx = event.x - last_x;
                    let dy = event.y - last_y;
                    (dx * dx + dy * dy) >= CURSOR_ACTIVITY_MOVE_DEADZONE_SQ
                } else {
                    true
                };

                if should_count_move {
                    activity_timestamps.push(event.timestamp_ms);
                    last_significant_move = Some((event.x, event.y));
                }
            },
            CursorEventType::LeftClick { .. }
            | CursorEventType::RightClick { .. }
            | CursorEventType::MiddleClick { .. }
            | CursorEventType::Scroll { .. } => {
                activity_timestamps.push(event.timestamp_ms);
            },
        }
    }

    activity_timestamps
}

fn get_cursor_idle_opacity(activity_timestamps: &[u64], time_ms: u64) -> f32 {
    if activity_timestamps.is_empty() {
        return 1.0;
    }

    let idx = match activity_timestamps.binary_search(&time_ms) {
        Ok(i) => i,
        Err(0) => return 1.0,
        Err(i) => i - 1,
    };

    let last_activity = activity_timestamps[idx];
    let idle_ms = time_ms.saturating_sub(last_activity);
    if idle_ms <= CURSOR_IDLE_TIMEOUT_MS {
        return 1.0;
    }

    if CURSOR_IDLE_FADE_DURATION_MS == 0 {
        return 0.0;
    }

    let fade_progress =
        (idle_ms - CURSOR_IDLE_TIMEOUT_MS) as f32 / CURSOR_IDLE_FADE_DURATION_MS as f32;
    (1.0 - fade_progress).clamp(0.0, 1.0)
}

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

fn sample_raw_motion_at_time(move_events: &[CursorEvent], time_ms: f64) -> (XY, XY) {
    if move_events.is_empty() {
        return (XY { x: 0.5, y: 0.5 }, XY::default());
    }

    // Before first event
    if time_ms <= move_events[0].timestamp_ms as f64 {
        let first = &move_events[0];
        let velocity = move_events
            .get(1)
            .map(|next| segment_velocity(first, next))
            .unwrap_or_default();
        return (
            XY {
                x: first.x as f32,
                y: first.y as f32,
            },
            velocity,
        );
    }

    // After last event
    let last = &move_events[move_events.len() - 1];
    if time_ms >= last.timestamp_ms as f64 {
        let velocity = move_events
            .get(move_events.len().saturating_sub(2))
            .map(|prev| segment_velocity(prev, last))
            .unwrap_or_default();
        return (
            XY {
                x: last.x as f32,
                y: last.y as f32,
            },
            velocity,
        );
    }

    // Between two move events: linear interpolation with segment velocity
    for i in 0..move_events.len() - 1 {
        let curr = &move_events[i];
        let next = &move_events[i + 1];
        if time_ms >= curr.timestamp_ms as f64 && time_ms < next.timestamp_ms as f64 {
            let dt_ms = (next.timestamp_ms.saturating_sub(curr.timestamp_ms)).max(1) as f64;
            let t = ((time_ms - curr.timestamp_ms as f64) / dt_ms) as f32;
            let velocity = segment_velocity(curr, next);
            return (
                XY {
                    x: (curr.x + (next.x - curr.x) * t as f64) as f32,
                    y: (curr.y + (next.y - curr.y) * t as f64) as f32,
                },
                velocity,
            );
        }
    }

    (
        XY {
            x: last.x as f32,
            y: last.y as f32,
        },
        XY::default(),
    )
}

fn get_adaptive_smoothing_strength(zoom_scale: f32, dampening: f32) -> f32 {
    if dampening <= 0.0 || zoom_scale <= CURSOR_SMOOTHING_MIN_ZOOM {
        return 0.0;
    }

    let zoom_factor = smoothstep(
        CURSOR_SMOOTHING_MIN_ZOOM,
        CURSOR_SMOOTHING_MAX_ZOOM,
        zoom_scale,
    );
    let base_dampening = dampening.clamp(0.0, 1.0);
    zoom_factor * base_dampening
}

fn get_adaptive_smoothing_window_ms(zoom_scale: f32, dampening: f32) -> f64 {
    if dampening <= 0.0 || zoom_scale <= CURSOR_SMOOTHING_MIN_ZOOM {
        return CURSOR_SMOOTHING_MIN_WINDOW_MS;
    }

    let zoom_factor = smoothstep(
        CURSOR_SMOOTHING_MIN_ZOOM,
        CURSOR_SMOOTHING_MAX_ZOOM,
        zoom_scale,
    ) as f64;
    let overdrive = (dampening - 1.0).max(0.0) as f64;
    CURSOR_SMOOTHING_MIN_WINDOW_MS
        + (CURSOR_SMOOTHING_MAX_WINDOW_MS - CURSOR_SMOOTHING_MIN_WINDOW_MS) * zoom_factor
        + CURSOR_SMOOTHING_OVERDRIVE_WINDOW_MS * zoom_factor * overdrive
}

fn get_smoothed_motion_at_time(
    move_events: &[CursorEvent],
    time_ms: f64,
    zoom_scale: f32,
    dampening: f32,
) -> (XY, XY) {
    let (raw_position, raw_velocity) = sample_raw_motion_at_time(move_events, time_ms);
    let smoothing_strength = get_adaptive_smoothing_strength(zoom_scale, dampening);

    if smoothing_strength <= 0.0 || move_events.len() < 3 {
        return (raw_position, raw_velocity);
    }

    let window_ms = get_adaptive_smoothing_window_ms(zoom_scale, dampening);

    let mut total_weight = 0.0_f32;
    let mut averaged_x = 0.0_f32;
    let mut averaged_y = 0.0_f32;

    for (offset, weight) in CURSOR_SMOOTHING_SAMPLE_OFFSETS
        .iter()
        .zip(CURSOR_SMOOTHING_SAMPLE_WEIGHTS.iter())
    {
        let sample_time_ms = time_ms + offset * window_ms;
        let (sample_position, _) = sample_raw_motion_at_time(move_events, sample_time_ms);
        total_weight += *weight;
        averaged_x += sample_position.x * *weight;
        averaged_y += sample_position.y * *weight;
    }

    if total_weight <= 0.0 {
        return (raw_position, raw_velocity);
    }

    averaged_x /= total_weight;
    averaged_y /= total_weight;

    let derivative_delta_ms = f64::max(
        CURSOR_SMOOTHING_MIN_VELOCITY_DELTA_MS,
        window_ms * CURSOR_SMOOTHING_VELOCITY_DELTA_RATIO,
    );
    let (before_position, _) =
        sample_raw_motion_at_time(move_events, time_ms - derivative_delta_ms);
    let (after_position, _) = sample_raw_motion_at_time(move_events, time_ms + derivative_delta_ms);
    let derivative_scale = 1000.0_f32 / f64::max(derivative_delta_ms * 2.0, 1.0) as f32;
    let averaged_velocity = XY {
        x: (after_position.x - before_position.x) * derivative_scale,
        y: (after_position.y - before_position.y) * derivative_scale,
    };
    let smoothed_position = XY {
        x: raw_position.x + (averaged_x - raw_position.x) * smoothing_strength,
        y: raw_position.y + (averaged_y - raw_position.y) * smoothing_strength,
    };
    let smoothed_velocity = XY {
        x: raw_velocity.x + (averaged_velocity.x - raw_velocity.x) * smoothing_strength,
        y: raw_velocity.y + (averaged_velocity.y - raw_velocity.y) * smoothing_strength,
    };
    let response_distance = ((smoothed_position.x - raw_position.x).powi(2)
        + (smoothed_position.y - raw_position.y).powi(2))
    .sqrt();
    let response_factor = smoothstep(
        CURSOR_CATCHUP_RESPONSE_START,
        CURSOR_CATCHUP_RESPONSE_END,
        response_distance,
    );
    let overdrive = (dampening - 1.0).max(0.0);
    let catchup_strength = (smoothing_strength
        * response_factor
        * (CURSOR_CATCHUP_BASE_STRENGTH + CURSOR_CATCHUP_OVERDRIVE_STRENGTH * overdrive))
        .min(0.65);

    (
        XY {
            x: smoothed_position.x + (raw_position.x - smoothed_position.x) * catchup_strength,
            y: smoothed_position.y + (raw_position.y - smoothed_position.y) * catchup_strength,
        },
        XY {
            x: smoothed_velocity.x + (raw_velocity.x - smoothed_velocity.x) * catchup_strength,
            y: smoothed_velocity.y + (raw_velocity.y - smoothed_velocity.y) * catchup_strength,
        },
    )
}

fn interpolate_cursor_at_time(
    move_events: &[CursorEvent],
    time_ms: f64,
    cursor_id: Option<String>,
    zoom_scale: f32,
    dampening: f32,
) -> InterpolatedCursor {
    let (position, velocity) =
        get_smoothed_motion_at_time(move_events, time_ms, zoom_scale, dampening);
    InterpolatedCursor {
        x: position.x,
        y: position.y,
        velocity_x: velocity.x,
        velocity_y: velocity.y,
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
pub type VideoContentBounds = SharedVideoContentBounds;

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
    let state = CursorCompositeState {
        x: cursor.x,
        y: cursor.y,
        velocity_x: cursor.velocity_x,
        velocity_y: cursor.velocity_y,
        opacity: cursor.opacity,
        scale: cursor.scale,
    };

    composite_cursor_shared(
        frame_data,
        frame_width,
        frame_height,
        video_bounds,
        &state,
        cursor_image,
        base_scale,
    );
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
    let state = CursorCompositeState {
        x: cursor.x,
        y: cursor.y,
        velocity_x: cursor.velocity_x,
        velocity_y: cursor.velocity_y,
        opacity: cursor.opacity,
        scale: cursor.scale,
    };

    composite_cursor_with_motion_blur_shared(
        CursorCompositeInput {
            frame_data,
            frame_width,
            frame_height,
            video_bounds,
            cursor: &state,
            cursor_image,
            base_scale,
        },
        motion_blur_amount,
    );
}

/// Get an SVG cursor as a DecodedCursorImage at the specified target extent.
///
/// Uses dominant-dimension normalization so all cursor shapes render at
/// visually consistent sizes. Delegates to `get_svg_cursor`.
pub fn get_svg_cursor_image(
    shape: crate::commands::video_recording::cursor::events::WindowsCursorShape,
    target_extent: u32,
) -> Option<DecodedCursorImage> {
    let rendered = super::svg_cursor::get_svg_cursor(shape, target_extent)?;

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
    fn test_cursor_idle_fades_out_after_timeout() {
        let mut recording = test_recording();
        // Ensure the most recent activity is at 400ms.
        recording.events.push(CursorEvent {
            timestamp_ms: 400,
            x: 1.0,
            y: 0.5,
            event_type: CursorEventType::LeftClick { pressed: true },
            cursor_id: None,
        });
        let interp = CursorInterpolator::new(&recording, &CursorConfig::default());

        // Last explicit activity is at 400ms (click above).
        let visible = interp.get_cursor_at(1500, 1.0);
        let fading = interp.get_cursor_at(1700, 1.0);
        let hidden = interp.get_cursor_at(2100, 1.0);

        assert!((visible.opacity - 1.0).abs() < 0.0001);
        assert!(fading.opacity > 0.0 && fading.opacity < 1.0);
        assert!(hidden.opacity <= 0.01);
    }

    #[test]
    fn test_cursor_idle_opacity_resets_on_click_activity() {
        let mut recording = test_recording();
        recording.events.push(CursorEvent {
            timestamp_ms: 2600,
            x: 1.0,
            y: 0.5,
            event_type: CursorEventType::LeftClick { pressed: true },
            cursor_id: None,
        });

        let interp = CursorInterpolator::new(&recording, &CursorConfig::default());
        let before_click = interp.get_cursor_at(2500, 1.0);
        let on_click = interp.get_cursor_at(2600, 1.0);

        assert!(before_click.opacity <= 0.01);
        assert!((on_click.opacity - 1.0).abs() < 0.0001);
    }

    #[test]
    fn test_cursor_idle_ignores_tiny_move_jitter() {
        let mut recording = test_recording();
        recording.events.push(CursorEvent {
            timestamp_ms: 2500,
            x: 1.0003,
            y: 0.5,
            event_type: CursorEventType::Move,
            cursor_id: None,
        });

        let interp = CursorInterpolator::new(&recording, &CursorConfig::default());
        let after_jitter = interp.get_cursor_at(2600, 1.0);

        assert!(after_jitter.opacity <= 0.01);
    }

    #[test]
    fn test_cursor_idle_fade_can_be_disabled() {
        let recording = test_recording();
        let mut cursor_config = CursorConfig::default();
        cursor_config.hide_when_idle = false;

        let interp = CursorInterpolator::new(&recording, &cursor_config);
        let cursor = interp.get_cursor_at(10_000, 1.0);
        assert!((cursor.opacity - 1.0).abs() < 0.0001);
    }

    #[test]
    fn test_cursor_interpolator_uses_raw_interpolation() {
        let recording = test_recording();

        let raw_interp = CursorInterpolator::new(&recording, &CursorConfig::default());
        let raw_cursor = raw_interp.get_cursor_at(100, 1.0);
        assert!((raw_cursor.x - 0.5).abs() < 0.05);
    }

    #[test]
    fn test_cursor_interpolator_is_deterministic() {
        let recording = test_recording();

        let interp = CursorInterpolator::new(&recording, &CursorConfig::default());
        let a = interp.get_cursor_at(120, 1.0);
        let b = interp.get_cursor_at(120, 1.0);

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
        let cursor = interp.get_cursor_at(0, 1.0);
        assert!((cursor.x - 0.5).abs() < 0.05);
    }

    #[test]
    fn test_cursor_interpolator_smooths_abrupt_jumps_at_high_zoom() {
        let recording = CursorRecording {
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
                    timestamp_ms: 1000,
                    x: 0.0,
                    y: 0.5,
                    event_type: CursorEventType::Move,
                    cursor_id: None,
                },
                CursorEvent {
                    timestamp_ms: 1010,
                    x: 1.0,
                    y: 0.5,
                    event_type: CursorEventType::Move,
                    cursor_id: None,
                },
                CursorEvent {
                    timestamp_ms: 2000,
                    x: 1.0,
                    y: 0.5,
                    event_type: CursorEventType::Move,
                    cursor_id: None,
                },
            ],
            cursor_images: HashMap::new(),
        };

        let mut cursor_config = CursorConfig::default();
        cursor_config.dampening = 1.0;

        let interp = CursorInterpolator::new(&recording, &cursor_config);
        let cursor = interp.get_cursor_at(1010, 4.0);

        assert!(cursor.x > 0.7);
        assert!(cursor.x < 1.0);
    }
}
