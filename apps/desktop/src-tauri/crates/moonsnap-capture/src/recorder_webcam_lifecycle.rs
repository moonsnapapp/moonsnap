//! Callback-driven webcam encoder lifecycle helpers.

use std::path::{Path, PathBuf};

/// Conditionally create a webcam encoder when a webcam output path is present.
pub fn maybe_start_webcam_encoder<E, FPrepareFeed, FCreateEncoder>(
    webcam_output_path: Option<&Path>,
    device_index: usize,
    mut prepare_feed: FPrepareFeed,
    mut create_encoder: FCreateEncoder,
) -> Option<E>
where
    FPrepareFeed: FnMut(usize) -> (u32, u32),
    FCreateEncoder: FnMut(PathBuf, u32, u32) -> Result<E, String>,
{
    if let Some(path) = webcam_output_path {
        let (width, height) = prepare_feed(device_index);
        match create_encoder(path.to_path_buf(), width, height) {
            Ok(encoder) => {
                log::info!("[WEBCAM] Feed encoder started: {}x{}", width, height);
                Some(encoder)
            },
            Err(e) => {
                log::warn!("[WEBCAM] Feed encoder failed: {}", e);
                None
            },
        }
    } else {
        None
    }
}

/// Finalize or cancel webcam encoder depending on recording outcome.
pub fn finalize_webcam_encoder<E, FCancel, FFinish, FRemove>(
    webcam_encoder: Option<E>,
    webcam_output_path: Option<&Path>,
    was_cancelled: bool,
    recording_duration_secs: f64,
    mut cancel_encoder: FCancel,
    mut finish_encoder: FFinish,
    mut remove_partial_file: FRemove,
) where
    FCancel: FnMut(E),
    FFinish: FnMut(E, f64) -> Result<(), String>,
    FRemove: FnMut(&Path),
{
    if let Some(encoder) = webcam_encoder {
        if was_cancelled {
            cancel_encoder(encoder);
            if let Some(path) = webcam_output_path {
                remove_partial_file(path);
            }
        } else if let Err(e) = finish_encoder(encoder, recording_duration_secs) {
            log::warn!("Webcam encoding failed: {}", e);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{finalize_webcam_encoder, maybe_start_webcam_encoder};
    use std::cell::RefCell;
    use std::path::{Path, PathBuf};
    use std::rc::Rc;

    #[test]
    fn start_returns_none_without_path() {
        let prepared = Rc::new(RefCell::new(false));
        let created = Rc::new(RefCell::new(false));

        let encoder = maybe_start_webcam_encoder(
            None,
            0,
            {
                let prepared = Rc::clone(&prepared);
                move |_idx| {
                    *prepared.borrow_mut() = true;
                    (1, 1)
                }
            },
            {
                let created = Rc::clone(&created);
                move |_path, _w, _h| {
                    *created.borrow_mut() = true;
                    Ok::<u32, String>(1)
                }
            },
        );

        assert_eq!(encoder, None);
        assert!(!*prepared.borrow());
        assert!(!*created.borrow());
    }

    #[test]
    fn start_creates_encoder_when_path_exists() {
        let dims = Rc::new(RefCell::new((0u32, 0u32)));
        let output = maybe_start_webcam_encoder(
            Some(Path::new("C:/captures/webcam.mp4")),
            4,
            |_idx| (640, 480),
            {
                let dims = Rc::clone(&dims);
                move |_path, w, h| {
                    *dims.borrow_mut() = (w, h);
                    Ok::<u32, String>(42)
                }
            },
        );

        assert_eq!(output, Some(42));
        assert_eq!(*dims.borrow(), (640, 480));
    }

    #[test]
    fn start_returns_none_on_create_error() {
        let output = maybe_start_webcam_encoder(
            Some(Path::new("C:/captures/webcam.mp4")),
            1,
            |_idx| (640, 480),
            |_path, _w, _h| Err::<u32, String>("boom".to_string()),
        );
        assert_eq!(output, None);
    }

    #[test]
    fn finalize_cancel_path_calls_cancel_and_remove() {
        let cancelled = Rc::new(RefCell::new(false));
        let removed: Rc<RefCell<Option<PathBuf>>> = Rc::new(RefCell::new(None));

        finalize_webcam_encoder(
            Some(7u32),
            Some(Path::new("C:/captures/webcam.mp4")),
            true,
            1.0,
            {
                let cancelled = Rc::clone(&cancelled);
                move |_enc| *cancelled.borrow_mut() = true
            },
            |_enc, _duration| Ok(()),
            {
                let removed = Rc::clone(&removed);
                move |path| *removed.borrow_mut() = Some(path.to_path_buf())
            },
        );

        assert!(*cancelled.borrow());
        assert_eq!(
            removed.borrow().as_deref(),
            Some(Path::new("C:/captures/webcam.mp4"))
        );
    }

    #[test]
    fn finalize_finish_path_calls_finish() {
        let finished = Rc::new(RefCell::new(false));
        let duration = Rc::new(RefCell::new(0.0f64));

        finalize_webcam_encoder(
            Some(9u32),
            Some(Path::new("C:/captures/webcam.mp4")),
            false,
            3.25,
            |_enc| {},
            {
                let finished = Rc::clone(&finished);
                let duration = Rc::clone(&duration);
                move |_enc, d| {
                    *finished.borrow_mut() = true;
                    *duration.borrow_mut() = d;
                    Ok(())
                }
            },
            |_path| {},
        );

        assert!(*finished.borrow());
        assert_eq!(*duration.borrow(), 3.25);
    }
}
