# moonsnap-error

Application-level error type and result/context helpers for the MoonSnap
desktop binary. Consumed only by the main `moonsnap` crate — the focused
library crates (`moonsnap-capture`, `scap-*`, etc.) define their own narrower
error enums rather than depending on this aggregate.

## Scope

- Canonical application error type: `MoonSnapError`
- Result alias: `MoonSnapResult<T>`
- Lightweight context helpers: `ResultExt`, `OptionExt`, `LockResultExt`

## Usage

```rust
use moonsnap_error::{OptionExt, MoonSnapResult};

fn parse_required(input: Option<&str>) -> MoonSnapResult<&str> {
    input.context("required value missing")
}
```

## Non-goals

- Tauri command wiring
- Platform capture/render logic
- Domain DTO definitions
