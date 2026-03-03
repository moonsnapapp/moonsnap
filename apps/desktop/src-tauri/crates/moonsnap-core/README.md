# moonsnap-core

Shared foundational primitives used by MoonSnap crates.

## Scope

- Canonical error type: `MoonSnapError`
- Result alias: `MoonSnapResult<T>`
- Lightweight context helpers: `ResultExt`, `OptionExt`, `LockResultExt`

## Usage

```rust
use moonsnap_core::{OptionExt, MoonSnapResult};

fn parse_required(input: Option<&str>) -> MoonSnapResult<&str> {
    input.context("required value missing")
}
```

## Non-goals

- Tauri command wiring
- Platform capture/render logic
- Domain DTO definitions
