---
name: regen-types
description: Regenerate TypeScript types from Rust structs via ts-rs
user-invocable: true
---

Regenerate TypeScript types from Rust structs using ts-rs:

```bash
cargo test --manifest-path E:/snapit/apps/desktop/src-tauri/Cargo.toml --lib
```

After running:
1. Report any type generation failures
2. List newly generated or updated files in `apps/desktop/src/types/generated/`
3. Remind: **NEVER manually edit files in `src/types/generated/`** - they are auto-generated from Rust

If there are issues with `#[ts(export_to = "...")]` paths, all should point to `"../../src/types/generated/"` relative to the Rust file.
