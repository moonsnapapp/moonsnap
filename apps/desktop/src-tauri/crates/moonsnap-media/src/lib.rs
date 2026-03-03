#![doc = include_str!("../README.md")]

pub mod ffmpeg;

#[cfg(test)]
mod tests {
    use super::ffmpeg::THUMBNAIL_SIZE;

    #[test]
    fn root_module_surface_smoke_test() {
        assert_eq!(THUMBNAIL_SIZE, 400);
    }
}
