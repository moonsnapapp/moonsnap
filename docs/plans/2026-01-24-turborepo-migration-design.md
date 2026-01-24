# Turborepo Migration Design

## Overview

Migrate SnapIt from a single-app repository to a Turborepo monorepo to support:
- The existing Tauri desktop app
- A new Next.js website + docs (combined as one app)
- Shared UI components and configuration

## Goals

1. **Code sharing** - Reuse shadcn/ui components across desktop and web
2. **Unified tooling** - Single ESLint, Tailwind, TypeScript config
3. **Build orchestration** - Coordinated builds, caching, CI efficiency
4. **Organization** - Everything in one repo for easier management

## Directory Structure

```
snapit/
├── apps/
│   ├── desktop/                    # Tauri app (current app moved here)
│   │   ├── src/                    # React frontend
│   │   │   ├── hooks/              # Tauri-dependent hooks (stay here)
│   │   │   ├── utils/              # App-specific utilities (stay here)
│   │   │   └── ...
│   │   ├── src-tauri/              # Rust backend
│   │   └── package.json
│   │
│   └── web/                        # Next.js website + docs
│       ├── src/
│       │   ├── app/                # App Router pages
│       │   │   ├── (marketing)/    # Landing, features, pricing
│       │   │   └── docs/           # Documentation (MDX)
│       │   └── components/         # Web-specific components
│       └── package.json
│
├── packages/
│   ├── ui/                         # Shared shadcn/ui components
│   ├── config-eslint/              # Shared ESLint config
│   ├── config-tailwind/            # Shared Tailwind preset (includes design tokens)
│   └── config-typescript/          # Shared tsconfig base
│
├── turbo.json                      # Task pipeline config
├── package.json                    # Root workspace config
└── bunfig.toml                     # Bun workspace definition
```

## Package Manager

**Bun** - Staying with existing package manager.

```toml
# bunfig.toml (root)
[workspace]
packages = ["apps/*", "packages/*"]
```

## Turborepo Configuration

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "src-tauri/target/**"]
    },
    "dev": {
      "persistent": true,
      "cache": false
    },
    "lint": {
      "dependsOn": ["^build"]
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    }
  }
}
```

## Root Scripts

```json
{
  "scripts": {
    "dev": "turbo dev",
    "dev:desktop": "turbo dev --filter=desktop",
    "dev:web": "turbo dev --filter=web",
    "build": "turbo build",
    "lint": "turbo lint",
    "test": "turbo test"
  }
}
```

## Shared Packages

### `packages/ui`
- Extracted shadcn/ui components (Button, Input, Dialog, etc.)
- Import as: `import { Button } from "@snapit/ui"`
- Both apps consume these components

### `packages/config-eslint`
- Base ESLint rules
- Extended by each app with app-specific rules

### `packages/config-tailwind`
- Tailwind preset with theme (colors, spacing, typography)
- Acts as design tokens - single source of truth
- Extended by each app

### `packages/config-typescript`
- Base tsconfig
- Extended by each app

## What Stays in Desktop App

- **Hooks** - Most are Tauri-dependent (`useTauriEvent`, `useCapture`, etc.)
- **Utils** - Capture/video-specific utilities
- **Generated types** - From Rust via ts-rs

## CI/CD Updates

### ci.yml

```yaml
jobs:
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt

      - name: Rust cache
        uses: swatinem/rust-cache@v2
        with:
          workspaces: './apps/desktop/src-tauri -> target'

      - run: bun install

      # Frontend checks via Turbo
      - run: bun turbo lint typecheck test --filter=...[origin/main]

      # Rust checks
      - run: cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check
      - run: cargo clippy --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
      - run: cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib
      - run: git diff --exit-code apps/desktop/src/types/generated/

  check-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun turbo build --filter=web
```

### release.yml

Update paths from `src-tauri` to `apps/desktop/src-tauri`.

## Migration Plan

### Phase 1: Scaffold structure
1. Create `apps/` and `packages/` directories
2. Move current code into `apps/desktop/`
3. Set up root `package.json`, `bunfig.toml`, `turbo.json`

### Phase 2: Extract shared packages
4. Create `packages/ui/` - move shadcn components
5. Create `packages/config-eslint/`
6. Create `packages/config-tailwind/`
7. Create `packages/config-typescript/`

### Phase 3: Wire up imports
8. Update `apps/desktop` to import from `@snapit/ui`, etc.
9. Verify desktop app still builds and runs

### Phase 4: Add web app
10. Create `apps/web/` with Next.js
11. Import shared packages
12. Set up basic pages (landing, docs)

### Phase 5: Update CI/CD
13. Update workflow paths
14. Add turbo commands

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Package manager | Bun | Already in use, works with Turborepo |
| Web framework | Next.js | Consistent DX, good code sharing with React |
| Website + docs | Combined | Simpler, likely a SPA-style docs site |
| Hooks package | Not extracted | Most are Tauri-dependent |
| Utils package | Not extracted | App-specific, YAGNI |
| Design tokens | In Tailwind config | Avoids redundancy |
