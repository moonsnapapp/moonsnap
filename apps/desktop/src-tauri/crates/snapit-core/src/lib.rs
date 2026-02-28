#![doc = include_str!("../README.md")]

pub mod error;

pub use error::{LockResultExt, OptionExt, ResultExt, SnapItError, SnapItResult};

#[cfg(test)]
mod tests {
    use super::{OptionExt, SnapItError, SnapItResult};

    #[test]
    fn root_exports_smoke_test() {
        let missing: Option<u8> = None;
        let result: SnapItResult<u8> = missing.context("missing value");
        assert!(matches!(result, Err(SnapItError::Other(_))));
    }
}
