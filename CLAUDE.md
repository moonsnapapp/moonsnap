# SnapIt Development Notes

## Quick Reference

```bash
# Development
npm run tauri dev        # Full app with hot reload
npm run dev              # Vite only (no Tauri)

# Quality (run before pushing)
bun run typecheck && bun run lint && bun run test:run

# Regenerate TS types from Rust
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
```

## Critical Rules

- **Never** use `as any`, `@ts-ignore`, or `@ts-expect-error`
- **Never** edit `apps/desktop/src/types/generated/*` (auto-generated from Rust)
- **Never** use `box-shadow` for external shadows (use `filter: drop-shadow()`)
- **Never** run `cargo build --release` unless explicitly requested
- Uses `bun` for package management

## Structure (Monorepo)

```
snapit/
├── apps/desktop/           # Main Tauri app
│   ├── src/                # React frontend (TypeScript)
│   │   ├── components/     # UI components
│   │   ├── hooks/          # Custom React hooks
│   │   ├── stores/         # Zustand state management
│   │   └── types/generated/ # AUTO-GENERATED from Rust
│   └── src-tauri/          # Rust backend
│       ├── src/commands/   # Tauri command handlers
│       └── src/rendering/  # wgpu GPU pipeline
└── packages/               # Shared packages
```

## Detailed Guides

See [AGENTS.md](./AGENTS.md) for comprehensive patterns, conventions, and debugging tips.
