//! Streaming video decoder - single FFmpeg process for all frames.
//!
//! Uses synchronous blocking I/O with BufReader for efficient pipe reads.
//! Designed to run in a blocking thread (spawn_blocking) to avoid stalling
//! the tokio runtime.

use std::io::{BufReader, Read};
use std::path::Path;
use std::process::{Child, Command, Stdio};

use moonsnap_render::types::{DecodedFrame, PixelFormat};

/// BufReader capacity for FFmpeg stdout pipe (2MB).
/// Reduces syscall count for ~8MB/frame reads from thousands to ~4.
const BUFREADER_CAPACITY: usize = 2 * 1024 * 1024;

/// Streaming video decoder using a single FFmpeg process.
pub struct StreamDecoder {
    /// FFmpeg child process.
    process: Option<Child>,
    /// Buffered reader wrapping FFmpeg stdout.
    stdout: Option<BufReader<std::process::ChildStdout>>,
    /// Video dimensions.
    width: u32,
    height: u32,
    /// Frame rate.
    fps: f64,
    /// Duration in milliseconds.
    #[allow(dead_code)]
    duration_ms: u64,
    /// Total frame count.
    frame_count: u32,
    /// Current frame index.
    current_frame: u32,
    /// Bytes per frame (depends on pixel_format).
    frame_size: usize,
    /// Start time offset in seconds.
    start_time_secs: f64,
    /// Reusable read buffer (swapped out each frame to avoid clone).
    buffer: Vec<u8>,
    /// Output pixel format (Rgba or Nv12).
    pixel_format: PixelFormat,
}

impl StreamDecoder {
    /// Create a new streaming decoder.
    ///
    /// # Arguments
    /// * `path` - Path to video file
    /// * `start_ms` - Start time in milliseconds (for trimming)
    /// * `end_ms` - End time in milliseconds (for trimming)
    pub fn new(path: &Path, start_ms: u64, end_ms: u64) -> Result<Self, String> {
        // Get video metadata
        let metadata = get_video_metadata(path)?;

        let width = metadata.width;
        let height = metadata.height;
        let fps = metadata.fps;
        let duration_ms = end_ms.saturating_sub(start_ms);
        let frame_count = ((duration_ms as f64 / 1000.0) * fps).ceil() as u32;
        let frame_size = (width * height * 4) as usize; // Default RGBA
        let start_time_secs = start_ms as f64 / 1000.0;

        Ok(Self {
            process: None,
            stdout: None,
            width,
            height,
            fps,
            duration_ms,
            frame_count,
            current_frame: 0,
            frame_size,
            start_time_secs,
            buffer: Vec::new(),
            pixel_format: PixelFormat::Rgba,
        })
    }

    /// Set the output pixel format. Must be called before `start()`.
    ///
    /// NV12 reduces pipe bandwidth by 62% (w*h*3/2 vs w*h*4) and skips
    /// FFmpeg's CPU swscale conversion.
    pub fn with_pixel_format(mut self, format: PixelFormat) -> Self {
        self.pixel_format = format;
        self.frame_size = match format {
            PixelFormat::Rgba => (self.width * self.height * 4) as usize,
            PixelFormat::Nv12 => (self.width * self.height * 3 / 2) as usize,
        };
        self
    }

    /// Start the decoder with a single FFmpeg process.
    pub fn start(&mut self, path: &Path) -> Result<(), String> {
        let ffmpeg_path = moonsnap_media::ffmpeg::find_ffmpeg().ok_or("FFmpeg not found")?;

        let pix_fmt = match self.pixel_format {
            PixelFormat::Rgba => "rgba",
            PixelFormat::Nv12 => "nv12",
        };

        log::info!(
            "[STREAM_DECODER] Starting: {:?} at {:.3}s, {}x{} @ {:.2}fps, {} frames, fmt={}",
            path,
            self.start_time_secs,
            self.width,
            self.height,
            self.fps,
            self.frame_count,
            pix_fmt
        );

        // Build FFmpeg command to output continuous raw frames
        #[cfg(windows)]
        let mut process = {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            Command::new(&ffmpeg_path)
                .creation_flags(CREATE_NO_WINDOW)
                .args([
                    "-hwaccel",
                    "auto",
                    "-threads",
                    "0",
                    "-ss",
                    &format!("{:.3}", self.start_time_secs),
                    "-i",
                    &path.to_string_lossy(),
                    "-frames:v",
                    &self.frame_count.to_string(),
                    "-f",
                    "rawvideo",
                    "-pix_fmt",
                    pix_fmt,
                    "-s",
                    &format!("{}x{}", self.width, self.height),
                    "-",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|e| format!("Failed to start FFmpeg: {}", e))?
        };

        #[cfg(not(windows))]
        let mut process = Command::new(&ffmpeg_path)
            .args([
                "-hwaccel",
                "auto",
                "-threads",
                "0",
                "-ss",
                &format!("{:.3}", self.start_time_secs),
                "-i",
                &path.to_string_lossy(),
                "-frames:v",
                &self.frame_count.to_string(),
                "-f",
                "rawvideo",
                "-pix_fmt",
                pix_fmt,
                "-s",
                &format!("{}x{}", self.width, self.height),
                "-",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start FFmpeg decoder: {}", e))?;

        // Take stdout and wrap in BufReader for efficient large reads
        let stdout = process
            .stdout
            .take()
            .ok_or("Failed to capture FFmpeg stdout")?;
        self.stdout = Some(BufReader::with_capacity(BUFREADER_CAPACITY, stdout));
        self.process = Some(process);
        self.current_frame = 0;

        // Pre-allocate reusable read buffer
        self.buffer = vec![0u8; self.frame_size];

        Ok(())
    }

    /// Read the next frame from the stream (blocking).
    ///
    /// Moves the internal buffer into the returned frame to avoid an 8MB clone.
    /// A new buffer is allocated for the next read.
    pub fn next_frame(&mut self) -> Result<Option<DecodedFrame>, String> {
        let stdout = self.stdout.as_mut().ok_or("Decoder not started")?;

        match stdout.read_exact(&mut self.buffer) {
            Ok(()) => {
                let frame_number = self.current_frame;
                let timestamp_ms = ((frame_number as f64 / self.fps) * 1000.0) as u64;

                self.current_frame += 1;

                // Move buffer out (zero-copy handoff), allocate fresh for next read.
                // The allocator typically recycles the recently-freed memory.
                let frame_data = std::mem::take(&mut self.buffer);
                self.buffer = vec![0u8; self.frame_size];

                Ok(Some(DecodedFrame {
                    frame_number,
                    timestamp_ms,
                    data: frame_data,
                    width: self.width,
                    height: self.height,
                    format: self.pixel_format,
                }))
            },
            Err(e) if e.kind() == std::io::ErrorKind::UnexpectedEof => {
                // End of stream
                Ok(None)
            },
            Err(e) => Err(format!("Read error: {}", e)),
        }
    }

    /// Stop the decoder and clean up.
    pub fn stop(&mut self) {
        // Drop stdout first to close the pipe (unblocks FFmpeg if it's writing)
        self.stdout.take();
        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }

    /// Get video width.
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Get video height.
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Get video FPS.
    #[allow(dead_code)]
    pub fn fps(&self) -> f64 {
        self.fps
    }

    /// Get total frame count.
    pub fn frame_count(&self) -> u32 {
        self.frame_count
    }
}

impl Drop for StreamDecoder {
    fn drop(&mut self) {
        // Drop stdout to close the pipe
        self.stdout.take();
        if let Some(mut process) = self.process.take() {
            let _ = process.kill();
            let _ = process.wait();
        }
    }
}

/// Video metadata from ffprobe.
struct VideoMetadata {
    width: u32,
    height: u32,
    fps: f64,
}

/// Get video metadata using ffprobe.
fn get_video_metadata(path: &Path) -> Result<VideoMetadata, String> {
    use crate::commands::video_recording::video_project::VideoMetadata as ProjectMetadata;

    let meta = ProjectMetadata::from_file(path)?;

    Ok(VideoMetadata {
        width: meta.width,
        height: meta.height,
        fps: meta.fps as f64,
    })
}
