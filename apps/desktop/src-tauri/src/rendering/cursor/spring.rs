//! Spring-physics model for cursor motion smoothing.
//!
//! Split out of the `cursor` motion pipeline. `SpringSimulation` integrates a
//! damped spring toward a moving target; the `*_spring` helpers tune the
//! constants per interaction mode. A child module so it can read the parent's
//! private `XY` / `SIMULATION_TICK_MS` without widening their visibility.

use moonsnap_domain::video_project::CursorConfig;

use super::{SIMULATION_TICK_MS, XY};

/// Spring configuration for cursor movement.
#[derive(Debug, Clone, Copy)]
pub(super) struct SpringConfig {
    tension: f32,  // Spring stiffness
    mass: f32,     // Object mass
    friction: f32, // Damping coefficient
}

/// Default spring configuration (tuned for smooth cursor following).
pub(super) const DEFAULT_SPRING: SpringConfig = SpringConfig {
    tension: 180.0,
    mass: 1.0,
    friction: 26.0,
};

/// Snappy profile - used within 160ms of a click (quick response).
pub(super) fn snappy_spring(base_spring: SpringConfig) -> SpringConfig {
    SpringConfig {
        tension: base_spring.tension * 1.65,
        mass: (base_spring.mass * 0.65).max(0.1),
        friction: base_spring.friction * 1.25,
    }
}

/// Drag profile - used when mouse button is held down (less bouncy).
pub(super) fn drag_spring(base_spring: SpringConfig) -> SpringConfig {
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

pub(super) struct SpringSimulation {
    pub(super) tension: f32,
    pub(super) mass: f32,
    pub(super) friction: f32,
    pub(super) position: XY,
    pub(super) velocity: XY,
    pub(super) target_position: XY,
}

impl SpringSimulation {
    pub(super) fn new(config: SpringConfig) -> Self {
        Self {
            tension: config.tension,
            mass: config.mass,
            friction: config.friction,
            position: XY::default(),
            velocity: XY::default(),
            target_position: XY::default(),
        }
    }

    pub(super) fn set_config(&mut self, config: SpringConfig) {
        self.tension = config.tension;
        self.mass = config.mass;
        self.friction = config.friction;
    }

    pub(super) fn set_position(&mut self, pos: XY) {
        self.position = pos;
    }

    pub(super) fn set_velocity(&mut self, vel: XY) {
        self.velocity = vel;
    }

    pub(super) fn set_target_position(&mut self, target: XY) {
        self.target_position = target;
    }

    /// Run simulation for given duration.
    /// Uses fixed timestep internally for stability.
    pub(super) fn run(&mut self, dt_ms: f32) -> XY {
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
