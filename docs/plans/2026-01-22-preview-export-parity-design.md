# Preview/Export CSS Parity System Design

**Date:** 2026-01-22
**Status:** Approved
**Goal:** Eliminate drift between preview (CSS) and export (GPU) rendering for captions, fonts, and background padding.

## Problem Statement

Currently, preview and export use separate implementations with duplicated magic numbers:

1. **Caption layout:** Hardcoded `40px` padding, `1.2` line-height in both TypeScript and Rust
2. **Font rendering:** CSS uses browser font resolution, Rust uses glyphon—different fonts may be selected for `sans-serif`
3. **Background padding:** CSS uses percentage-based padding, Rust uses absolute pixels. Manual fixed resolutions don't account for padding correctly.

## Solution: Single Source of Truth

Rust defines all layout constants and calculations. TypeScript consumes them via:
- `ts-rs` codegen for static values
- Tauri commands for dynamic values (font metrics)

```
┌─────────────────────────────────────────────────────────────┐
│                    parity.rs (Rust)                         │
│  - All layout constants (padding, line-height, scales)      │
│  - Font metric queries (for any font family)                │
│  - Background/composition calculations                      │
├─────────────────────────────────────────────────────────────┤
│                      ts-rs codegen                          │
├──────────────────────┬──────────────────────────────────────┤
│   ParityLayout.ts    │    Tauri Commands                    │
│   (static values)    │    (dynamic font metrics)            │
└──────────────────────┴──────────────────────────────────────┘
         │                         │
         ▼                         ▼
┌─────────────────────────────────────────────────────────────┐
│              React Preview (CSS)                            │
│  - Imports ParityLayout                                     │
│  - Calls `get_font_metrics(family)` for dynamic values      │
│  - Uses exact px values, no % hacks                         │
└─────────────────────────────────────────────────────────────┘
```

## Parity Constants Module

**File:** `src-tauri/src/rendering/parity.rs`

```rust
pub mod layout {
    /// Reference resolution for scaling (1080p height)
    pub const REFERENCE_HEIGHT: f32 = 1080.0;

    /// Caption padding from edges (px at 1080p)
    pub const CAPTION_PADDING: f32 = 40.0;

    /// Caption background padding
    pub const CAPTION_BG_PADDING_H: f32 = 16.0;
    pub const CAPTION_BG_PADDING_V: f32 = 8.0;

    /// Caption corner radius (px at 1080p)
    pub const CAPTION_CORNER_RADIUS: f32 = 12.0;

    /// Line height multiplier (glyphon uses font_size * this)
    pub const LINE_HEIGHT_MULTIPLIER: f32 = 1.2;

    /// Background/wallpaper defaults
    pub const DEFAULT_BG_PADDING: f32 = 40.0;
    pub const DEFAULT_BG_ROUNDING: f32 = 12.0;
}

pub fn scale_factor(height: f32) -> f32 {
    height / layout::REFERENCE_HEIGHT
}
```

## TypeScript Types (Generated)

```typescript
// src/types/generated/ParityLayout.ts
export interface ParityLayout {
  reference_height: number;
  caption_padding: number;
  caption_bg_padding_h: number;
  caption_bg_padding_v: number;
  caption_corner_radius: number;
  line_height_multiplier: number;
  default_bg_padding: number;
  default_bg_rounding: number;
}
```

## Font Metrics API

Solves font resolution differences between browser and glyphon.

```rust
#[derive(TS, Clone, serde::Serialize)]
#[ts(export)]
pub struct FontMetrics {
    /// Actual font family that was resolved
    pub resolved_family: String,
    /// Line height in px for given font size
    pub line_height: f32,
    /// Ascender height (above baseline)
    pub ascender: f32,
    /// Descender depth (below baseline)
    pub descender: f32,
    /// Whether the requested font was found
    pub font_found: bool,
}

#[tauri::command]
pub fn get_font_metrics(family: String, size: f32, weight: u32) -> FontMetrics
```

React can now:
- Know the *actual* font glyphon resolved (not just "sans-serif")
- Use exact line height, ascender, descender values
- Warn user if font wasn't found

## Composition Bounds API

Solves background padding mismatch.

```rust
#[derive(TS, Clone, serde::Serialize)]
#[ts(export)]
pub struct CompositionBounds {
    pub output_width: f32,
    pub output_height: f32,
    pub frame_x: f32,
    pub frame_y: f32,
    pub frame_width: f32,
    pub frame_height: f32,
    pub effective_padding: f32,
}

pub fn calculate_composition_bounds(
    video_width: f32,
    video_height: f32,
    requested_padding: f32,
    manual_output: Option<(f32, f32)>,
) -> CompositionBounds
```

Both preview and export call this same function—identical positioning math.

## React Hook

**File:** `src/hooks/useParityLayout.ts`

```typescript
let cachedLayout: ParityLayout | null = null;

export async function initParityLayout() {
  cachedLayout = await invoke<ParityLayout>('get_parity_layout');
}

export function useParityLayout() {
  return cachedLayout!;
}

export function useScaledLayout(containerHeight: number) {
  const layout = useParityLayout();
  const scale = containerHeight / layout.reference_height;

  return {
    scale,
    captionPadding: layout.caption_padding * scale,
    captionBgPaddingH: layout.caption_bg_padding_h * scale,
    captionBgPaddingV: layout.caption_bg_padding_v * scale,
    captionCornerRadius: layout.caption_corner_radius * scale,
    lineHeightMultiplier: layout.line_height_multiplier,
  };
}

export async function getFontMetrics(
  family: string,
  size: number,
  weight: number = 400
): Promise<FontMetrics>
```

## Implementation Plan

### Phase 1: Create Parity Module (Rust)

1. Create `src-tauri/src/rendering/parity.rs` with `layout` constants
2. Add `ParityLayout`, `FontMetrics`, `CompositionBounds` structs with `ts-rs`
3. Add `calculate_composition_bounds()` function
4. Add Tauri commands: `get_parity_layout`, `get_font_metrics`, `get_composition_bounds`
5. Run `cargo test` to generate TypeScript types

### Phase 2: Create React Hook

1. Create `src/hooks/useParityLayout.ts`
2. Add `initParityLayout()`, `useParityLayout()`, `useScaledLayout()`
3. Add `getFontMetrics()` with caching
4. Call `initParityLayout()` in app startup

### Phase 3: Migrate Components

1. **CaptionOverlay.tsx** - Replace hardcoded values with `useScaledLayout()`
2. **GPUVideoPreview.tsx** - Use `get_composition_bounds` for background padding
3. **usePreviewStyles.ts** - Delegate composition math to Rust

### Phase 4: Migrate Rust Export

1. **caption_layer.rs** - Use `parity::layout::*` constants
2. **compositor.rs** - Use `calculate_composition_bounds()`
3. **exporter/mod.rs** - Use `calculate_composition_bounds()`

### Phase 5: Update Tests

1. **captionRenderingParity.test.ts** - Read from `get_parity_layout`
2. **caption_parity_test.rs** - Test against `parity` module
3. Add new test: `composition_bounds_parity.test.ts`

## File Changes Summary

**New files:**
- `src-tauri/src/rendering/parity.rs`
- `src/hooks/useParityLayout.ts`

**Generated files:**
- `src/types/generated/ParityLayout.ts`
- `src/types/generated/FontMetrics.ts`
- `src/types/generated/CompositionBounds.ts`

**Modified files:**
- `src-tauri/src/rendering/mod.rs`
- `src-tauri/src/rendering/caption_layer.rs`
- `src-tauri/src/rendering/compositor.rs`
- `src-tauri/src/rendering/exporter/mod.rs`
- `src/components/VideoEditor/CaptionOverlay.tsx`
- `src/components/VideoEditor/GPUVideoPreview.tsx`
- `src/components/VideoEditor/gpu/usePreviewStyles.ts`
- `src/components/VideoEditor/__tests__/captionRenderingParity.test.ts`
- `src-tauri/src/rendering/caption_parity_test.rs`
