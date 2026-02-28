# snapit-core

Shared foundational primitives used by SnapIt crates.

## Scope

- Canonical error type: `SnapItError`
- Result alias: `SnapItResult<T>`
- Lightweight context helpers: `ResultExt`, `OptionExt`, `LockResultExt`

## Usage

```rust
use snapit_core::{OptionExt, SnapItResult};

fn parse_required(input: Option<&str>) -> SnapItResult<&str> {
    input.context("required value missing")
}
```

## Non-goals

- Tauri command wiring
- Platform capture/render logic
- Domain DTO definitions
