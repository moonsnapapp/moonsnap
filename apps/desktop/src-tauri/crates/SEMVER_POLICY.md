# MoonSnap Shared Crates SemVer Policy

This policy applies to:

- `moonsnap-core`
- `moonsnap-domain`
- `moonsnap-media`
- `moonsnap-render`
- `moonsnap-capture`
- `moonsnap-export`

## Current Phase (0.x)

All shared crates are currently pre-1.0 and considered internal-but-reusable.

Versioning rules while pre-1.0:

1. Patch (`0.x.y`): bug fixes, refactors, test/docs changes, and behavior-preserving internal changes.
2. Minor (`0.x+1.0`): any public API surface change (additive or breaking).
3. Keep shared crate versions aligned across the `moonsnap-*` crate set unless there is a clear reason not to.

This conservative rule makes dependency updates explicit for consumers while APIs are still stabilizing.

## Future Phase (1.x+)

After stabilizing shared APIs and first external consumers:

1. Patch: backward-compatible fixes only.
2. Minor: backward-compatible additions.
3. Major: breaking API/behavior changes.

## Required Checks Before Version Bumps

1. Run crate contract tests:
   - `cargo test -p moonsnap-core --lib`
   - `cargo test -p moonsnap-domain --lib`
   - `cargo test -p moonsnap-media --lib`
   - `cargo test -p moonsnap-render --lib`
   - `cargo test -p moonsnap-capture --lib`
   - `cargo test -p moonsnap-export --lib`
2. Run app integration sanity:
   - `cargo test -p moonsnap --lib`
3. Confirm TS typegen path checks:
   - `bun run check:ts-rs-paths`
4. Update changelog/release notes and crate READMEs for any API-facing changes.

## Consumer Compatibility Notes

1. New shared crates should avoid leaking Tauri/runtime types in public APIs.
2. New public APIs should have crate-level tests that exercise end-to-end usage from crate root exports.
3. Prefer additive APIs over signature churn; deprecate first when practical.
