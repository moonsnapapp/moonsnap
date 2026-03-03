# MoonSnap Rebrand Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename the entire codebase from "SnapIt" / "snapit" to "MoonSnap" / "moonsnap" in a single atomic commit.

**Architecture:** Big Bang approach - all renames happen on one branch. Folder renames first (git mv), then file contents updated in dependency order (Cargo.toml → Rust source → package.json → TypeScript → config → CI → docs). Final verification grep ensures zero remaining "snapit" references.

**Tech Stack:** Rust (Cargo workspaces), TypeScript (bun monorepo), Tauri, GitHub Actions, Cloudflare Workers

---

### Task 1: Rename Rust Crate Folders

**Files:**
- Rename: `apps/desktop/src-tauri/crates/snapit-capture/` → `moonsnap-capture/`
- Rename: `apps/desktop/src-tauri/crates/snapit-core/` → `moonsnap-core/`
- Rename: `apps/desktop/src-tauri/crates/snapit-domain/` → `moonsnap-domain/`
- Rename: `apps/desktop/src-tauri/crates/snapit-media/` → `moonsnap-media/`
- Rename: `apps/desktop/src-tauri/crates/snapit-render/` → `moonsnap-render/`
- Rename: `apps/desktop/src-tauri/crates/snapit-export/` → `moonsnap-export/`

**Step 1: Rename all crate directories**

```bash
cd apps/desktop/src-tauri/crates
git mv snapit-capture moonsnap-capture
git mv snapit-core moonsnap-core
git mv snapit-domain moonsnap-domain
git mv snapit-media moonsnap-media
git mv snapit-render moonsnap-render
git mv snapit-export moonsnap-export
```

**Step 2: Rename the API folder**

```bash
cd E:/snapit
git mv snapit-api moonsnap-api
```

**Step 3: Verify renames**

```bash
ls apps/desktop/src-tauri/crates/
ls moonsnap-api/
```

Expected: All folders show `moonsnap-*` names. No `snapit-*` folders remain.

---

### Task 2: Update Root Cargo.toml

**Files:**
- Modify: `apps/desktop/src-tauri/Cargo.toml`

**Step 1: Update workspace and package metadata**

Find-and-replace in `apps/desktop/src-tauri/Cargo.toml`:

| Find | Replace |
|------|---------|
| `name = "snapit"` | `name = "moonsnap"` |
| `authors = ["SnapIt"]` | `authors = ["MoonSnap"]` |
| `name = "snapit_lib"` | `name = "moonsnap_lib"` |
| `"crates/snapit-capture"` | `"crates/moonsnap-capture"` |
| `"crates/snapit-core"` | `"crates/moonsnap-core"` |
| `"crates/snapit-domain"` | `"crates/moonsnap-domain"` |
| `"crates/snapit-media"` | `"crates/moonsnap-media"` |
| `"crates/snapit-render"` | `"crates/moonsnap-render"` |
| `"crates/snapit-export"` | `"crates/moonsnap-export"` |
| `snapit-camera-windows` | `moonsnap-camera-windows` |
| `snapit-capture = { path = "crates/snapit-capture" }` | `moonsnap-capture = { path = "crates/moonsnap-capture" }` |
| `snapit-core = { path = "crates/snapit-core" }` | `moonsnap-core = { path = "crates/moonsnap-core" }` |
| `snapit-domain = { path = "crates/snapit-domain" }` | `moonsnap-domain = { path = "crates/moonsnap-domain" }` |
| `snapit-media = { path = "crates/snapit-media" }` | `moonsnap-media = { path = "crates/moonsnap-media" }` |
| `snapit-render = { path = "crates/snapit-render" }` | `moonsnap-render = { path = "crates/moonsnap-render" }` |
| `snapit-export = { path = "crates/snapit-export" }` | `moonsnap-export = { path = "crates/moonsnap-export" }` |

**Step 2: Verify syntax**

```bash
cd apps/desktop/src-tauri && cargo verify-project 2>&1 || echo "check Cargo.toml syntax"
```

---

### Task 3: Update Individual Crate Cargo.toml Files

**Files:**
- Modify: `apps/desktop/src-tauri/crates/moonsnap-capture/Cargo.toml`
- Modify: `apps/desktop/src-tauri/crates/moonsnap-core/Cargo.toml`
- Modify: `apps/desktop/src-tauri/crates/moonsnap-domain/Cargo.toml`
- Modify: `apps/desktop/src-tauri/crates/moonsnap-media/Cargo.toml`
- Modify: `apps/desktop/src-tauri/crates/moonsnap-render/Cargo.toml`
- Modify: `apps/desktop/src-tauri/crates/moonsnap-export/Cargo.toml`
- Modify: `apps/desktop/src-tauri/crates/camera-windows/Cargo.toml`

**Step 1: Update each crate's Cargo.toml**

For every crate, replace:
- `name = "snapit-*"` → `name = "moonsnap-*"`
- All dependency paths: `snapit-domain = { path = "../snapit-domain" }` → `moonsnap-domain = { path = "../moonsnap-domain" }`
- Same for `snapit-media`, `snapit-render`, `snapit-capture`, `snapit-core`, `snapit-export`
- `camera-windows/Cargo.toml`: `name = "snapit-camera-windows"` → `name = "moonsnap-camera-windows"`, and update any `snapit-*` dependency paths

**Step 2: Verify Cargo workspace resolves**

```bash
cd apps/desktop/src-tauri && cargo metadata --no-deps --format-version 1 > /dev/null && echo "OK"
```

Expected: "OK" - workspace resolves without errors.

---

### Task 4: Update Rust Type Names (SnapItError, SnapItResult)

**Files:**
- Modify: `apps/desktop/src-tauri/crates/moonsnap-core/src/error.rs` (definition)
- Modify: All Rust files that reference `SnapItError` or `SnapItResult`

**Step 1: Global find-and-replace in all .rs files**

| Find | Replace |
|------|---------|
| `SnapItError` | `MoonSnapError` |
| `SnapItResult` | `MoonSnapResult` |

These are used extensively across the codebase. Use replace-all.

**Step 2: Verify no remaining references**

```bash
grep -r "SnapItError\|SnapItResult" apps/desktop/src-tauri/ --include="*.rs"
```

Expected: No output.

---

### Task 5: Update Rust `use` Statements and Crate References

**Files:**
- Modify: All `.rs` files under `apps/desktop/src-tauri/`

**Step 1: Global find-and-replace across all Rust files**

| Find | Replace |
|------|---------|
| `snapit_domain` | `moonsnap_domain` |
| `snapit_render` | `moonsnap_render` |
| `snapit_export` | `moonsnap_export` |
| `snapit_capture` | `moonsnap_capture` |
| `snapit_core` | `moonsnap_core` |
| `snapit_media` | `moonsnap_media` |
| `snapit_camera_windows` | `moonsnap_camera_windows` |
| `snapit_lib` | `moonsnap_lib` |

This covers:
- `use snapit_domain::` → `use moonsnap_domain::`
- `pub use snapit_domain::` → `pub use moonsnap_domain::`
- `snapit_lib::run()` → `moonsnap_lib::run()`
- All other crate reference patterns

**Step 2: Verify no remaining Rust crate references**

```bash
grep -r "snapit_" apps/desktop/src-tauri/ --include="*.rs"
```

Expected: No output (or only inside string literals, handled in next task).

---

### Task 6: Update Rust String Literals and Comments

**Files:**
- Modify: Multiple Rust source files with "SnapIt" in strings/comments

**Step 1: Replace display strings**

| File | Find | Replace |
|------|------|---------|
| `src/app/tray.rs` | `"Quit SnapIt"` | `"Quit MoonSnap"` |
| `src/preview/native_surface.rs` | `"SnapItCaptionPreview\0"` | `"MoonSnapCaptionPreview\0"` |
| `src/commands/logging.rs` | `"SnapIt"` (log category) | `"MoonSnap"` |
| `src/commands/keyboard_hook.rs` | `w!("SnapItHotkeyClass")` | `w!("MoonSnapHotkeyClass")` |
| `src/commands/keyboard_hook.rs` | `w!("SnapIt Hotkey Window")` | `w!("MoonSnap Hotkey Window")` |
| `src/commands/settings.rs` | `path.join("SnapIt")` | `path.join("MoonSnap")` |
| `src/commands/storage/mod.rs` | `pictures_dir.join("SnapIt")` | `pictures_dir.join("MoonSnap")` |
| `src/commands/storage/tests.rs` | `"/Users/test/Pictures/SnapIt"` | `"/Users/test/Pictures/MoonSnap"` |
| `src/commands/window/image_editor.rs` | `" - SnapIt"` | `" - MoonSnap"` |
| `src/commands/window/video_editor.rs` | `" - SnapIt"` | `" - MoonSnap"` |
| `src/commands/window/toolbar.rs` | `"SnapIt Capture"` | `"MoonSnap Capture"` |
| `src/commands/window/settings.rs` | `"SnapIt Settings"` | `"MoonSnap Settings"` |
| `src/commands/capture_overlay/types.rs` | `"SnapItCaptureOverlay"` | `"MoonSnapCaptureOverlay"` |
| `src/rendering/renderer.rs` | `"SnapIt Video Renderer"` | `"MoonSnap Video Renderer"` |

**Step 2: Update comments containing "SnapIt" or "snapit"**

Do a global replace of `SnapIt` → `MoonSnap` and `snapit` → `moonsnap` in Rust comments only. Be careful not to double-replace already-handled strings.

**Step 3: Verify no remaining "SnapIt" or "snapit" in Rust**

```bash
grep -ri "snapit" apps/desktop/src-tauri/ --include="*.rs"
```

Expected: No output.

---

### Task 7: Run cargo check

**Step 1: Run cargo check**

```bash
cd apps/desktop/src-tauri && cargo check 2>&1
```

Expected: Compiles successfully with no errors.

---

### Task 8: Update All package.json Files

**Files:**
- Modify: `package.json` (root)
- Modify: `apps/desktop/package.json`
- Modify: `apps/web/package.json`
- Modify: `packages/ui/package.json`
- Modify: `packages/changelog/package.json`
- Modify: `packages/config-eslint/package.json`
- Modify: `packages/config-tailwind/package.json`
- Modify: `packages/config-typescript/package.json`
- Modify: `moonsnap-api/package.json`

**Step 1: Global find-and-replace `@snapit/` → `@moonsnap/` across all package.json files**

This covers:
- All `"name"` fields
- All dependency references (`@snapit/changelog`, `@snapit/ui`, etc.)
- All devDependency references (`@snapit/config-eslint`, etc.)
- Script references (`--filter=@snapit/desktop`)

**Step 2: Update root package.json name**

`"name": "snapit"` → `"name": "moonsnap"`

**Step 3: Update API package name**

`"name": "snapit-feedback-api"` → `"name": "moonsnap-feedback-api"`

---

### Task 9: Update TypeScript Config and Build Files

**Files:**
- Modify: `apps/desktop/tsconfig.json`
- Modify: `apps/desktop/vite.config.ts`
- Modify: `apps/desktop/vitest.config.ts`
- Modify: `apps/web/next.config.ts`

**Step 1: Update tsconfig path aliases**

In `apps/desktop/tsconfig.json`, replace all `@snapit/` → `@moonsnap/` in the `paths` keys.

**Step 2: Update vite.config.ts aliases**

Replace `@snapit/changelog` and `@snapit/ui` → `@moonsnap/changelog` and `@moonsnap/ui`.

**Step 3: Update vitest.config.ts aliases**

Replace `@snapit/ui` → `@moonsnap/ui`.

**Step 4: Update next.config.ts**

Replace `@snapit/ui` → `@moonsnap/ui` in `transpilePackages`.

---

### Task 10: Update TypeScript Source Imports and Display Strings

**Files:**
- Modify: `apps/web/src/lib/releaseData.ts`
- Modify: `apps/web/src/app/page.tsx`
- Modify: `apps/desktop/src/components/Settings/ChangelogTab.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/desktop/src/windows/CaptureToolbarWindow.tsx`
- Modify: Any other TS/TSX files importing from `@snapit/`

**Step 1: Global find-and-replace `@snapit/` → `@moonsnap/` in all .ts/.tsx files**

**Step 2: Update display strings**

| File | Find | Replace |
|------|------|---------|
| `apps/desktop/src/App.tsx` | `title="SnapIt Library"` | `title="MoonSnap Library"` |
| `apps/desktop/src/windows/CaptureToolbarWindow.tsx` | `title="SnapIt Capture"` | `title="MoonSnap Capture"` |

**Step 3: Search for any other "SnapIt" or "snapit" in TypeScript**

```bash
grep -ri "snapit" apps/desktop/src/ apps/web/src/ packages/ --include="*.ts" --include="*.tsx"
```

Expected: No output.

---

### Task 11: Update Tauri Config

**Files:**
- Modify: `apps/desktop/src-tauri/tauri.conf.json`
- Modify: `apps/desktop/src-tauri/capabilities/desktop.json`

**Step 1: Update tauri.conf.json**

| Find | Replace |
|------|---------|
| `"productName": "SnapIt"` | `"productName": "MoonSnap"` |
| `"identifier": "com.snapit.app"` | `"identifier": "com.moonsnap.app"` |
| `"title": "SnapIt Library"` | `"title": "MoonSnap Library"` |
| `walterlow/snapit-releases` | `walterlow/moonsnap-releases` |

**Step 2: Update capabilities**

In `desktop.json`: `"Desktop capability for SnapIt screen capture"` → `"Desktop capability for MoonSnap screen capture"`

---

### Task 12: Update CI/CD Workflows

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

**Step 1: Update ci.yml crate matrix**

Replace all `snapit-` → `moonsnap-` in the matrix.crate entries:
- `snapit-core` → `moonsnap-core`
- `snapit-domain` → `moonsnap-domain`
- `snapit-media` → `moonsnap-media`
- `snapit-render` → `moonsnap-render`
- `snapit-capture` → `moonsnap-capture`
- `snapit-export` → `moonsnap-export`

Also: `@snapit/web` → `@moonsnap/web`

**Step 2: Update release.yml**

| Find | Replace |
|------|---------|
| `SnapIt v${{ steps.get-version.outputs.version }}` | `MoonSnap v${{ steps.get-version.outputs.version }}` |
| `PUBLIC_REPO: walterlow/snapit-releases` | `PUBLIC_REPO: walterlow/moonsnap-releases` |
| `` SnapIt v${version} `` | `` MoonSnap v${version} `` |

---

### Task 13: Update Feedback API Config

**Files:**
- Modify: `moonsnap-api/wrangler.toml`

**Step 1: Update wrangler.toml**

| Find | Replace |
|------|---------|
| `# SnapIt Feedback API Configuration` | `# MoonSnap Feedback API Configuration` |
| `name = "snapit-feedback"` | `name = "moonsnap-feedback"` |

---

### Task 14: Update Documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `AGENTS.md`
- Modify: `CHANGELOG.md`
- Modify: All crate READMEs under `apps/desktop/src-tauri/crates/`
- Modify: `moonsnap-api/README.md`
- Modify: `.claude/skills/` files that reference snapit

**Step 1: Global find-and-replace across all docs**

| Find | Replace |
|------|---------|
| `SnapIt` | `MoonSnap` |
| `snapit` | `moonsnap` |
| `@snapit/` | `@moonsnap/` |
| `snapit-` (in crate/package names) | `moonsnap-` |

Be careful with `CHANGELOG.md` — historical entries can be updated for consistency, or left as-is to preserve history. Recommend updating for consistency.

**Step 2: Verify no remaining references in docs**

```bash
grep -ri "snapit" *.md CLAUDE.md AGENTS.md apps/desktop/src-tauri/crates/*/README.md moonsnap-api/README.md .claude/skills/ 2>/dev/null
```

Expected: No output.

---

### Task 15: Reinstall Dependencies

**Step 1: Delete lockfiles and node_modules**

```bash
rm -rf node_modules apps/desktop/node_modules apps/web/node_modules packages/*/node_modules
rm -f bun.lock
```

**Step 2: Reinstall**

```bash
bun install
```

Expected: Clean install with no errors.

---

### Task 16: Final Verification

**Step 1: Full-codebase grep for any remaining "snapit"**

```bash
grep -ri "snapit" --include="*.rs" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.toml" --include="*.yml" --include="*.yaml" --include="*.md" --include="*.toml" -r .
```

Expected: Zero results (or only in git-ignored files like Cargo.lock).

**Step 2: Cargo check**

```bash
cd apps/desktop/src-tauri && cargo check
```

Expected: Compiles successfully.

**Step 3: Frontend quality checks**

```bash
bun run typecheck && bun run lint && bun run test:run
```

Expected: All pass.

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: rebrand SnapIt to MoonSnap"
```

---

## Manual External Actions (User Must Do)

After the code changes are committed:

1. **Rename GitHub repo** `walterlow/snapit` → `walterlow/moonsnap`
2. **Rename/create release repo** `walterlow/snapit-releases` → `walterlow/moonsnap-releases`
3. **Rename Cloudflare Worker** `snapit-feedback` → `moonsnap-feedback`
4. **Update any DNS/domain** references if applicable
5. **Update app store listings** if applicable

## Out of Scope

- Icon/image assets (visual rebrand is separate)
- `camera-windows` crate folder name (not snapit-prefixed, only the crate name inside Cargo.toml)
- Git history rewriting
- Cargo.lock (regenerates automatically)
