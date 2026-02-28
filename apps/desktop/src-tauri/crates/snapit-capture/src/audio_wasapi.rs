//! WASAPI loopback capture for system audio.
//!
//! Captures what's playing on the computer's speakers using
//! Windows Audio Session API (WASAPI) in loopback mode.
//!
//! This is the only reliable way to capture system audio on Windows.
//! The `cpal` crate doesn't support loopback capture.
//!
//! NOTE: Some methods are currently unused because VideoEncoder handles audio
//! internally. This code is kept for potential future FFmpeg migration.

#![allow(dead_code)]

use crossbeam_channel::Sender;
use snapit_domain::recording::AudioOutputDevice;
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;
use wasapi::*;

/// A frame of audio samples with timestamp.
#[derive(Clone)]
pub struct AudioFrame {
    /// Interleaved f32 samples (stereo: L, R, L, R, ...)
    pub samples: Vec<f32>,
    /// Timestamp in 100-nanosecond units (Windows FILETIME format)
    /// This matches what VideoEncoder expects.
    pub timestamp_100ns: i64,
    /// Number of audio frames (samples / channels)
    pub frame_count: usize,
}

/// WASAPI loopback audio capture.
///
/// Captures system audio (what's playing on speakers) using WASAPI loopback mode.
pub struct WasapiLoopback {
    audio_client: AudioClient,
    capture_client: AudioCaptureClient,
    event_handle: Handle,
    block_align: u32,
    channels: u16,
    sample_rate: u32,
}

impl WasapiLoopback {
    /// Create a new WASAPI loopback capture using the default render device.
    pub fn new() -> Result<Self, String> {
        Self::with_device(None)
    }

    /// Create a new WASAPI loopback capture, optionally targeting a specific device.
    ///
    /// If `device_id` is `None`, uses the system default render device.
    pub fn with_device(device_id: Option<&str>) -> Result<Self, String> {
        // Initialize COM for this thread
        initialize_mta()
            .ok()
            .map_err(|e| format!("Failed to initialize COM: {:?}", e))?;

        let enumerator = DeviceEnumerator::new()
            .map_err(|e| format!("Failed to create device enumerator: {:?}", e))?;

        // Look up device by ID, or fall back to default
        let device = if let Some(id) = device_id {
            Self::find_device_by_id(&enumerator, id)?
        } else {
            enumerator
                .get_default_device(&Direction::Render)
                .map_err(|e| format!("Failed to get default audio device: {:?}", e))?
        };

        let device_name = device
            .get_friendlyname()
            .unwrap_or_else(|_| "Unknown".to_string());
        log::info!("WASAPI loopback: using device '{}'", device_name);

        Self::from_device(device)
    }

    /// Initialize loopback capture from a specific wasapi Device.
    fn from_device(device: Device) -> Result<Self, String> {
        // Get audio client
        let mut audio_client = device
            .get_iaudioclient()
            .map_err(|e| format!("Failed to get audio client: {:?}", e))?;

        // Define desired format: 32-bit float, 48kHz, stereo
        let desired_format = WaveFormat::new(32, 32, &SampleType::Float, 48000, 2, None);
        let block_align = desired_format.get_blockalign();
        let channels = desired_format.get_nchannels();
        let sample_rate = desired_format.get_samplespersec();

        log::info!(
            "WASAPI format: {} Hz, {} channels, {} bits, block_align={}",
            sample_rate,
            channels,
            32,
            block_align
        );

        // Get device timing
        let (_def_time, min_time) = audio_client
            .get_device_period()
            .map_err(|e| format!("Failed to get device period: {:?}", e))?;

        // Create stream mode - use EventsShared for efficient event-driven capture
        // Note: Loopback ONLY works in Shared mode
        let mode = StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: min_time,
        };

        // Initialize for CAPTURE on a RENDER device = loopback mode
        audio_client
            .initialize_client(&desired_format, &Direction::Capture, &mode)
            .map_err(|e| format!("Failed to initialize audio client: {:?}", e))?;

        // Set up event handle for buffer notifications
        let event_handle = audio_client
            .set_get_eventhandle()
            .map_err(|e| format!("Failed to get event handle: {:?}", e))?;

        // Get capture client interface
        let capture_client = audio_client
            .get_audiocaptureclient()
            .map_err(|e| format!("Failed to get capture client: {:?}", e))?;

        Ok(Self {
            audio_client,
            capture_client,
            event_handle,
            block_align,
            channels,
            sample_rate,
        })
    }

    /// Find a render device by its wasapi ID string.
    fn find_device_by_id(enumerator: &DeviceEnumerator, target_id: &str) -> Result<Device, String> {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|e| format!("Failed to get device collection: {:?}", e))?;

        for device_result in collection.into_iter() {
            if let Ok(device) = device_result {
                if let Ok(id) = device.get_id() {
                    if id == target_id {
                        return Ok(device);
                    }
                }
            }
        }

        // Device not found — fall back to default
        log::warn!(
            "WASAPI: device ID '{}' not found, falling back to default",
            target_id
        );
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|e| format!("Failed to get default audio device: {:?}", e))
    }

    /// Get the sample rate.
    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// Get the number of channels.
    pub fn channels(&self) -> u16 {
        self.channels
    }

    /// Run the capture loop, sending audio frames to the provided channel.
    ///
    /// This blocks until `should_stop` is set to true.
    ///
    /// # Arguments
    /// * `audio_tx` - Channel to send captured audio frames
    /// * `start_time` - Recording start time for timestamp calculation
    /// * `should_stop` - Atomic flag to signal when to stop
    /// * `is_paused` - Atomic flag indicating if recording is paused
    pub fn capture_loop(
        self,
        audio_tx: Sender<AudioFrame>,
        start_time: Instant,
        should_stop: Arc<AtomicBool>,
        is_paused: Arc<AtomicBool>,
    ) -> Result<(), String> {
        // Prepare buffer for captured samples
        let mut sample_queue: VecDeque<u8> = VecDeque::with_capacity(
            self.block_align as usize * 48000, // ~1 second buffer
        );

        // Track pause time for accurate timestamps
        let mut total_pause_duration = std::time::Duration::ZERO;
        let mut pause_started_at: Option<Instant> = None;

        // Hybrid timing: sync start with video clock, then use sample-based for smooth progression
        // - First frame after start/resume: use elapsed time (syncs with video)
        // - Subsequent frames: increment by exact sample duration (no jitter)
        let mut base_timestamp_100ns: Option<i64> = None;
        let mut samples_since_base: u64 = 0;
        let samples_to_100ns = 10_000_000.0 / self.sample_rate as f64;

        // Track pause state
        let mut was_paused = false;

        // Start the audio stream
        self.audio_client
            .start_stream()
            .map_err(|e| format!("Failed to start audio stream: {:?}", e))?;

        log::info!(
            "WASAPI capture started: {} Hz, {} ch (hybrid timestamps)",
            self.sample_rate,
            self.channels
        );

        // Track total frames for logging
        let mut total_frames_captured: u64 = 0;

        // Capture loop
        loop {
            // Check if we should stop
            if should_stop.load(Ordering::Relaxed) {
                break;
            }

            // Handle pause state
            let currently_paused = is_paused.load(Ordering::Relaxed);
            if currently_paused {
                if !was_paused {
                    // Just entered pause - record when pause started
                    pause_started_at = Some(Instant::now());
                    was_paused = true;
                    log::debug!("Audio capture paused");
                }
                // Drain audio buffer during pause to prevent accumulation
                // This keeps the audio device happy and prevents buffer overflow
                if self.event_handle.wait_for_event(10).is_ok() {
                    let _ = self
                        .capture_client
                        .read_from_device_to_deque(&mut sample_queue);
                    sample_queue.clear(); // Discard paused audio
                }
                std::thread::sleep(std::time::Duration::from_millis(5));
                continue;
            } else if was_paused {
                // Just resumed - accumulate pause duration and reset hybrid timing
                let pause_duration = if let Some(pause_start) = pause_started_at.take() {
                    let duration = pause_start.elapsed();
                    total_pause_duration += duration;
                    duration
                } else {
                    std::time::Duration::ZERO
                };
                // Reset hybrid timing to re-sync with video after resume
                base_timestamp_100ns = None;
                samples_since_base = 0;
                log::debug!(
                    "Audio resumed after pause of {:?}, total pause: {:?}",
                    pause_duration,
                    total_pause_duration
                );

                // Drain any stale audio - be more aggressive after longer pauses
                // After long pauses, the audio buffer may have accumulated more stale data
                // and the device may need time to stabilize
                let drain_iterations = if pause_duration.as_secs() >= 5 {
                    20 // ~200ms of drain time for long pauses
                } else if pause_duration.as_secs() >= 1 {
                    10 // ~100ms for medium pauses
                } else {
                    5 // ~50ms for short pauses
                };

                let mut drained_samples = 0;
                let mut consecutive_empty = 0;
                for _ in 0..drain_iterations {
                    if should_stop.load(Ordering::Relaxed) {
                        break;
                    }
                    if self.event_handle.wait_for_event(10).is_ok() {
                        if self
                            .capture_client
                            .read_from_device_to_deque(&mut sample_queue)
                            .is_ok()
                        {
                            if !sample_queue.is_empty() {
                                drained_samples += sample_queue.len();
                                sample_queue.clear();
                                consecutive_empty = 0;
                            } else {
                                consecutive_empty += 1;
                                // Exit early if we've had 2 consecutive empty reads
                                if consecutive_empty >= 2 {
                                    break;
                                }
                            }
                        }
                    } else {
                        consecutive_empty += 1;
                        if consecutive_empty >= 2 {
                            break;
                        }
                    }
                }

                // After long pauses, discard the first batch of "fresh" audio too
                // as it may contain transition artifacts
                if pause_duration.as_secs() >= 3 {
                    // Wait for and discard one more buffer to skip transition artifacts
                    if self.event_handle.wait_for_event(50).is_ok() {
                        if self
                            .capture_client
                            .read_from_device_to_deque(&mut sample_queue)
                            .is_ok()
                        {
                            if !sample_queue.is_empty() {
                                log::debug!(
                                    "Discarded {} bytes of transition audio after long pause",
                                    sample_queue.len()
                                );
                                sample_queue.clear();
                            }
                        }
                    }
                }

                if drained_samples > 0 {
                    log::debug!(
                        "Drained {} bytes of accumulated audio after resume",
                        drained_samples
                    );
                }
                was_paused = false;
            }

            // Wait for buffer event (with timeout of 100ms)
            if self.event_handle.wait_for_event(100).is_err() {
                continue;
            }

            // Read audio data into queue
            match self
                .capture_client
                .read_from_device_to_deque(&mut sample_queue)
            {
                Ok(_buffer_info) => {
                    // Process captured audio if we have enough data
                    if sample_queue.len() >= self.block_align as usize {
                        // Convert bytes to f32 samples
                        let samples = bytes_to_f32_samples(&sample_queue);
                        let frame_count = samples.len() / self.channels as usize;

                        // Hybrid timing: sync start with video, then use sample-based for smooth progression
                        // First frame: use elapsed time to sync with video start
                        // Subsequent frames: increment by exact sample count (jitter-free)
                        let timestamp_100ns = if let Some(base_ts) = base_timestamp_100ns {
                            // Use sample-based increment for smooth, jitter-free audio
                            base_ts + (samples_since_base as f64 * samples_to_100ns) as i64
                        } else {
                            // First frame - sync with video clock
                            let actual_elapsed = start_time.elapsed() - total_pause_duration;
                            let ts = (actual_elapsed.as_micros() * 10) as i64;
                            base_timestamp_100ns = Some(ts);
                            ts
                        };

                        // Track samples for next timestamp calculation
                        samples_since_base += frame_count as u64;
                        total_frames_captured += frame_count as u64;

                        // Clear the queue
                        sample_queue.clear();

                        // Send audio frame (non-blocking - drop if channel is full)
                        let frame = AudioFrame {
                            samples,
                            timestamp_100ns,
                            frame_count,
                        };

                        if audio_tx.try_send(frame).is_err() {
                            log::trace!("Audio channel full, dropping frame");
                        }
                    }
                },
                Err(e) => {
                    log::warn!("Failed to read audio: {:?}", e);
                },
            }
        }

        // Stop the stream
        self.audio_client
            .stop_stream()
            .map_err(|e| format!("Failed to stop audio stream: {:?}", e))?;

        log::info!(
            "WASAPI capture stopped, total frames: {}",
            total_frames_captured
        );
        Ok(())
    }
}

/// Convert raw audio bytes (32-bit float) to f32 samples.
fn bytes_to_f32_samples(data: &VecDeque<u8>) -> Vec<f32> {
    let bytes: Vec<u8> = data.iter().copied().collect();
    bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect()
}

/// List available audio output (render) devices.
///
/// Returns a list of output devices with ID, name, and default status.
pub fn list_output_devices() -> Result<Vec<AudioOutputDevice>, String> {
    let _ = initialize_mta();

    let enumerator = DeviceEnumerator::new()
        .map_err(|e| format!("Failed to create device enumerator: {:?}", e))?;

    // Get default device ID for comparison
    let default_id = enumerator
        .get_default_device(&Direction::Render)
        .ok()
        .and_then(|d| d.get_id().ok());

    let collection = enumerator
        .get_device_collection(&Direction::Render)
        .map_err(|e| format!("Failed to get device collection: {:?}", e))?;

    let mut result = Vec::new();
    for device_result in collection.into_iter() {
        if let Ok(device) = device_result {
            let device_id = device.get_id().ok();
            let is_default = device_id.is_some() && device_id == default_id;

            let name = device
                .get_friendlyname()
                .unwrap_or_else(|_| "Unknown Device".to_string());

            if let Some(id) = device_id {
                result.push(AudioOutputDevice {
                    id,
                    name,
                    is_default,
                });
            }
        }
    }

    log::debug!("[AUDIO] Found {} output devices", result.len());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bytes_to_f32() {
        let mut data = VecDeque::new();
        let f: f32 = 0.5;
        for b in f.to_le_bytes() {
            data.push_back(b);
        }
        let samples = bytes_to_f32_samples(&data);
        assert_eq!(samples.len(), 1);
        assert!((samples[0] - 0.5).abs() < 0.0001);
    }

    #[test]
    fn test_list_output_devices() {
        // Should not panic
        let devices = list_output_devices().unwrap_or_default();
        println!("Found {} output devices", devices.len());
        for device in &devices {
            println!(
                "  {} - {} (default: {})",
                device.name, device.id, device.is_default
            );
        }
    }
}
