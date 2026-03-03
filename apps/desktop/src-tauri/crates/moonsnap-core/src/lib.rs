#![doc = include_str!("../README.md")]

pub mod error;

pub use error::{LockResultExt, MoonSnapError, MoonSnapResult, OptionExt, ResultExt};

#[cfg(test)]
mod tests {
    use super::{MoonSnapError, MoonSnapResult, OptionExt};

    #[test]
    fn root_exports_smoke_test() {
        let missing: Option<u8> = None;
        let result: MoonSnapResult<u8> = missing.context("missing value");
        assert!(matches!(result, Err(MoonSnapError::Other(_))));
    }
}
