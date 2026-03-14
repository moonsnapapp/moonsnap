use std::path::Path;

/// Set the Windows Hidden attribute on all files inside a .moonsnap bundle.
/// On non-Windows platforms, this is a no-op.
pub fn set_hidden_on_bundle_contents(bundle_path: &Path) {
    #[cfg(target_os = "windows")]
    {
        if let Ok(entries) = std::fs::read_dir(bundle_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    set_hidden_attribute(&path);
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = bundle_path;
    }
}

#[cfg(target_os = "windows")]
fn set_hidden_attribute(path: &Path) {
    use std::os::windows::ffi::OsStrExt;

    // Use Windows API to set FILE_ATTRIBUTE_HIDDEN
    // Constants from windows-sys
    const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
    const INVALID_FILE_ATTRIBUTES: u32 = u32::MAX;

    extern "system" {
        fn GetFileAttributesW(lpFileName: *const u16) -> u32;
        fn SetFileAttributesW(lpFileName: *const u16, dwFileAttributes: u32) -> i32;
    }

    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    unsafe {
        let attrs = GetFileAttributesW(wide.as_ptr());
        if attrs != INVALID_FILE_ATTRIBUTES {
            SetFileAttributesW(wide.as_ptr(), attrs | FILE_ATTRIBUTE_HIDDEN);
        }
    }
}
