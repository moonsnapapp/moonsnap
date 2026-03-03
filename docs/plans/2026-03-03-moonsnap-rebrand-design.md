# MoonSnap Rebrand Design

**Date:** 2026-03-03
**Approach:** Big Bang - single atomic rebrand commit

## Naming Convention Map

| Context | Old | New |
|---------|-----|-----|
| Display name (UI, titles) | `SnapIt` | `MoonSnap` |
| Package scope | `@snapit/*` | `@moonsnap/*` |
| Rust crate prefix | `snapit-*` | `moonsnap-*` |
| Rust lib name | `snapit_lib` | `moonsnap_lib` |
| Bundle identifier | `com.snapit.app` | `com.moonsnap.app` |
| Cloudflare worker | `snapit-feedback` | `moonsnap-feedback` |
| GitHub release repo | `walterlow/snapit-releases` | `walterlow/moonsnap-releases` |
| Root package name | `snapit` | `moonsnap` |
| Folder names | `snapit-*` | `moonsnap-*` |

## Execution Order

### Step 1: Folder Renames (git mv)

Leaves first so subsequent edits target new paths:

1. `crates/snapit-capture/` → `crates/moonsnap-capture/`
2. `crates/snapit-core/` → `crates/moonsnap-core/`
3. `crates/snapit-domain/` → `crates/moonsnap-domain/`
4. `crates/snapit-media/` → `crates/moonsnap-media/`
5. `crates/snapit-render/` → `crates/moonsnap-render/`
6. `crates/snapit-export/` → `crates/moonsnap-export/`
7. `snapit-api/` → `moonsnap-api/`

### Step 2: Cargo.toml Files

Update all 8 Cargo.toml files:
- Workspace members list
- Crate names
- Crate dependencies (snapit-* → moonsnap-*)
- Authors field
- Lib name (snapit_lib → moonsnap_lib)

### Step 3: package.json Files

Update all package.json files:
- Root: name
- `apps/desktop`: name (@snapit/desktop → @moonsnap/desktop)
- `apps/web`: name + dependencies
- `packages/ui`: name + devDependencies
- `packages/changelog`: name + devDependencies
- `packages/config-eslint`: name
- `packages/config-tailwind`: name
- `packages/config-typescript`: name
- `moonsnap-api`: name

### Step 4: TypeScript Config

- `apps/desktop/tsconfig.json`: path aliases (@snapit/* → @moonsnap/*)

### Step 5: Tauri Config

- `tauri.conf.json`: productName, identifier, window title, update URL

### Step 6: Rust Source Code

- `main.rs`: snapit_lib::run() → moonsnap_lib::run()
- All `use snapit_*` imports across crates
- `tray.rs`: "Quit SnapIt" → "Quit MoonSnap"
- Capability description

### Step 7: TypeScript Source Code

- All `@snapit/*` imports → `@moonsnap/*`
- Display strings in App.tsx, CaptureToolbarWindow.tsx

### Step 8: CI/CD Workflows

- `ci.yml`: crate test matrix names
- `release.yml`: release names, public repo reference

### Step 9: Documentation

- README.md, CLAUDE.md, AGENTS.md, CHANGELOG.md
- All crate READMEs
- .claude/skills referencing snapit

### Step 10: Verify

```bash
cargo check
bun run typecheck && bun run lint && bun run test:run
grep -ri "snapit" --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.toml" --include="*.yml" --include="*.md" .
```

## Manual External Actions (User)

- Rename GitHub repo `walterlow/snapit` → `walterlow/moonsnap`
- Rename/create GitHub repo `walterlow/moonsnap-releases`
- Rename Cloudflare Worker `snapit-feedback` → `moonsnap-feedback`
- Update any DNS/domain references

## Out of Scope

- Icon/image assets (visual rebrand is separate)
- `camera-windows` crate folder (not snapit-prefixed)
- Git history rewriting
- Lockfiles (regenerate automatically)
