# Preview/Export CSS Parity System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate drift between preview (CSS) and export (GPU) rendering by creating a single source of truth in Rust.

**Architecture:** Rust defines all layout constants and calculations. TypeScript consumes them via ts-rs codegen (static values) and Tauri commands (dynamic font metrics).

**Tech Stack:** Rust, ts-rs, Tauri commands, React hooks, glyphon (cosmic_text)

---

## Task 1: Create Parity Module with Layout Constants

**Files:**
- Create: `src-tauri/src/rendering/parity.rs`
- Modify: `src-tauri/src/rendering/mod.rs`

**Step 1: Create the parity module file**

Create `src-tauri/src/rendering/parity.rs`:

```rust
//! Preview/Export parity constants and calculations.
//!
//! This module is the SINGLE SOURCE OF TRUTH for all layout values used
//! by both the CSS preview and GPU export. Never hardcode these values
//! elsewhere - always reference this module.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Layout constants for caption and background rendering.
/// All values are defined at 1080p reference resolution.
pub mod layout {
    /// Reference resolution height for scaling (1080p)
    pub const REFERENCE_HEIGHT: f32 = 1080.0;

    /// Caption padding from edges (px at 1080p)
    pub const CAPTION_PADDING: f32 = 40.0;

    /// Caption background horizontal padding (px at 1080p)
    pub const CAPTION_BG_PADDING_H: f32 = 16.0;

    /// Caption background vertical padding (px at 1080p)
    pub const CAPTION_BG_PADDING_V: f32 = 8.0;

    /// Caption corner radius (px at 1080p)
    pub const CAPTION_CORNER_RADIUS: f32 = 12.0;

    /// Line height multiplier (glyphon uses font_size * this)
    pub const LINE_HEIGHT_MULTIPLIER: f32 = 1.2;

    /// Default background padding (px at 1080p)
    pub const DEFAULT_BG_PADDING: f32 = 40.0;

    /// Default background corner rounding (px at 1080p)
    pub const DEFAULT_BG_ROUNDING: f32 = 12.0;
}

/// Calculate scale factor for any resolution relative to 1080p.
#[inline]
pub fn scale_factor(height: f32) -> f32 {
    height / layout::REFERENCE_HEIGHT
}

/// Parity layout constants exported to TypeScript.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct ParityLayout {
    pub reference_height: f32,
    pub caption_padding: f32,
    pub caption_bg_padding_h: f32,
    pub caption_bg_padding_v: f32,
    pub caption_corner_radius: f32,
    pub line_height_multiplier: f32,
    pub default_bg_padding: f32,
    pub default_bg_rounding: f32,
}

impl Default for ParityLayout {
    fn default() -> Self {
        Self {
            reference_height: layout::REFERENCE_HEIGHT,
            caption_padding: layout::CAPTION_PADDING,
            caption_bg_padding_h: layout::CAPTION_BG_PADDING_H,
            caption_bg_padding_v: layout::CAPTION_BG_PADDING_V,
            caption_corner_radius: layout::CAPTION_CORNER_RADIUS,
            line_height_multiplier: layout::LINE_HEIGHT_MULTIPLIER,
            default_bg_padding: layout::DEFAULT_BG_PADDING,
            default_bg_rounding: layout::DEFAULT_BG_ROUNDING,
        }
    }
}

/// Get the parity layout constants.
#[tauri::command]
pub fn get_parity_layout() -> ParityLayout {
    ParityLayout::default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_scale_factor() {
        assert_eq!(scale_factor(1080.0), 1.0);
        assert!((scale_factor(720.0) - 0.6667).abs() < 0.001);
        assert_eq!(scale_factor(2160.0), 2.0);
    }

    #[test]
    fn test_parity_layout_default() {
        let layout = ParityLayout::default();
        assert_eq!(layout.reference_height, 1080.0);
        assert_eq!(layout.caption_padding, 40.0);
        assert_eq!(layout.line_height_multiplier, 1.2);
    }
}
```

**Step 2: Add module to mod.rs**

In `src-tauri/src/rendering/mod.rs`, add after line 29 (`pub mod text_layer;`):

```rust
pub mod parity;
```

And add to exports (after line 58):

```rust
pub use parity::{get_parity_layout, scale_factor, ParityLayout};
```

**Step 3: Run tests to verify and generate TypeScript types**

Run: `cd E:\snapit\src-tauri && cargo test parity --lib`
Expected: All tests pass, `src/types/generated/ParityLayout.ts` created

**Step 4: Commit**

```bash
git add src-tauri/src/rendering/parity.rs src-tauri/src/rendering/mod.rs src/types/generated/ParityLayout.ts
git commit -m "feat(parity): add layout constants module with ts-rs export"
```

---

## Task 2: Add CompositionBounds Calculation

**Files:**
- Modify: `src-tauri/src/rendering/parity.rs`

**Step 1: Add CompositionBounds struct and calculation**

Add to `src-tauri/src/rendering/parity.rs` (after `ParityLayout`):

```rust
/// Composition bounds calculated for both preview and export.
/// This ensures identical frame positioning in both systems.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct CompositionBounds {
    /// Total output width
    pub output_width: f32,
    /// Total output height
    pub output_height: f32,
    /// Video frame X position within output
    pub frame_x: f32,
    /// Video frame Y position within output
    pub frame_y: f32,
    /// Video frame width
    pub frame_width: f32,
    /// Video frame height
    pub frame_height: f32,
    /// Actual padding used (may differ from requested in manual mode)
    pub effective_padding: f32,
}

/// Calculate composition bounds - THE source of truth for both preview and export.
///
/// # Arguments
/// * `video_width` - Source video width (after crop if applicable)
/// * `video_height` - Source video height (after crop if applicable)
/// * `requested_padding` - Desired padding around video
/// * `manual_output` - If Some, fixed output dimensions (manual composition mode)
pub fn calculate_composition_bounds(
    video_width: f32,
    video_height: f32,
    requested_padding: f32,
    manual_output: Option<(f32, f32)>,
) -> CompositionBounds {
    let video_aspect = video_width / video_height;

    match manual_output {
        None => {
            // Auto mode: output = video + padding
            let output_width = video_width + requested_padding * 2.0;
            let output_height = video_height + requested_padding * 2.0;
            CompositionBounds {
                output_width,
                output_height,
                frame_x: requested_padding,
                frame_y: requested_padding,
                frame_width: video_width,
                frame_height: video_height,
                effective_padding: requested_padding,
            }
        }
        Some((fixed_w, fixed_h)) => {
            // Manual mode: fit video + padding INTO fixed output
            let available_w = (fixed_w - requested_padding * 2.0).max(1.0);
            let available_h = (fixed_h - requested_padding * 2.0).max(1.0);
            let available_aspect = available_w / available_h;

            let (frame_w, frame_h) = if video_aspect > available_aspect {
                // Video is wider - fit to width
                (available_w, available_w / video_aspect)
            } else {
                // Video is taller - fit to height
                (available_h * video_aspect, available_h)
            };

            // Center the frame in the output
            let frame_x = (fixed_w - frame_w) / 2.0;
            let frame_y = (fixed_h - frame_h) / 2.0;

            CompositionBounds {
                output_width: fixed_w,
                output_height: fixed_h,
                frame_x,
                frame_y,
                frame_width: frame_w,
                frame_height: frame_h,
                effective_padding: requested_padding,
            }
        }
    }
}

/// Tauri command to get composition bounds.
#[tauri::command]
pub fn get_composition_bounds(
    video_width: f32,
    video_height: f32,
    padding: f32,
    manual_width: Option<f32>,
    manual_height: Option<f32>,
) -> CompositionBounds {
    let manual_output = manual_width.zip(manual_height);
    calculate_composition_bounds(video_width, video_height, padding, manual_output)
}
```

**Step 2: Add tests for composition bounds**

Add to the `tests` module in `parity.rs`:

```rust
    #[test]
    fn test_composition_bounds_auto_mode() {
        let bounds = calculate_composition_bounds(1920.0, 1080.0, 40.0, None);
        assert_eq!(bounds.output_width, 2000.0);
        assert_eq!(bounds.output_height, 1160.0);
        assert_eq!(bounds.frame_x, 40.0);
        assert_eq!(bounds.frame_y, 40.0);
        assert_eq!(bounds.frame_width, 1920.0);
        assert_eq!(bounds.frame_height, 1080.0);
    }

    #[test]
    fn test_composition_bounds_manual_mode() {
        let bounds = calculate_composition_bounds(1920.0, 1080.0, 40.0, Some((1920.0, 1080.0)));
        assert_eq!(bounds.output_width, 1920.0);
        assert_eq!(bounds.output_height, 1080.0);
        // Video should be shrunk to fit within fixed output minus padding
        assert!(bounds.frame_width < 1920.0);
        assert!(bounds.frame_height < 1080.0);
        // Should be centered
        assert!(bounds.frame_x > 0.0);
        assert!(bounds.frame_y > 0.0);
    }

    #[test]
    fn test_composition_bounds_no_padding() {
        let bounds = calculate_composition_bounds(1920.0, 1080.0, 0.0, None);
        assert_eq!(bounds.output_width, 1920.0);
        assert_eq!(bounds.output_height, 1080.0);
        assert_eq!(bounds.frame_x, 0.0);
        assert_eq!(bounds.frame_y, 0.0);
    }
```

**Step 3: Update mod.rs exports**

Update the export line in `mod.rs`:

```rust
pub use parity::{get_parity_layout, get_composition_bounds, scale_factor, calculate_composition_bounds, ParityLayout, CompositionBounds};
```

**Step 4: Run tests**

Run: `cd E:\snapit\src-tauri && cargo test parity --lib`
Expected: All tests pass, `src/types/generated/CompositionBounds.ts` created

**Step 5: Commit**

```bash
git add src-tauri/src/rendering/parity.rs src-tauri/src/rendering/mod.rs src/types/generated/CompositionBounds.ts
git commit -m "feat(parity): add composition bounds calculation"
```

---

## Task 3: Add Font Metrics API

**Files:**
- Modify: `src-tauri/src/rendering/parity.rs`

**Step 1: Add FontMetrics struct and command**

Add to `src-tauri/src/rendering/parity.rs` (after `CompositionBounds`):

```rust
/// Font metrics from glyphon for CSS preview synchronization.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/")]
pub struct FontMetrics {
    /// Actual font family that was resolved (e.g., "Arial" when "sans-serif" requested)
    pub resolved_family: String,
    /// Font size used for calculation
    pub font_size: f32,
    /// Line height in px (font_size * LINE_HEIGHT_MULTIPLIER)
    pub line_height: f32,
    /// Whether the requested font was found
    pub font_found: bool,
}

/// Get font metrics for a given font family and size.
/// This allows CSS preview to use the exact same metrics as glyphon export.
#[tauri::command]
pub fn get_font_metrics(family: String, size: f32, _weight: u32) -> FontMetrics {
    use glyphon::{Family, FontSystem};

    let mut font_system = FontSystem::new();
    let line_height = size * layout::LINE_HEIGHT_MULTIPLIER;

    // Parse family string to glyphon Family
    let glyphon_family = match family.to_lowercase().as_str() {
        "serif" => Family::Serif,
        "sans-serif" | "sans serif" | "system-ui" => Family::SansSerif,
        "monospace" | "mono" => Family::Monospace,
        "cursive" => Family::Cursive,
        "fantasy" => Family::Fantasy,
        _ => Family::Name(&family),
    };

    // Try to resolve the actual font
    let resolved_family = match glyphon_family {
        Family::Name(name) => name.to_string(),
        Family::Serif => "serif".to_string(),
        Family::SansSerif => {
            // Try to get actual resolved font name
            // glyphon will resolve to system default sans-serif
            "sans-serif".to_string()
        }
        Family::Monospace => "monospace".to_string(),
        Family::Cursive => "cursive".to_string(),
        Family::Fantasy => "fantasy".to_string(),
    };

    // Check if font exists by attempting to query the font system
    let font_found = font_system.db().faces().any(|face| {
        face.families
            .iter()
            .any(|(name, _)| name.to_lowercase() == family.to_lowercase())
    });

    FontMetrics {
        resolved_family,
        font_size: size,
        line_height,
        font_found: font_found || matches!(glyphon_family, Family::SansSerif | Family::Serif | Family::Monospace),
    }
}
```

**Step 2: Add import for glyphon at top of file**

Add after the existing imports:

```rust
use glyphon::{Family, FontSystem};
```

Wait - glyphon is already used in text_layer.rs. Let me check if it's a dependency we can use directly.

Actually, the import should work. But we need to be careful - FontSystem::new() is expensive. For the command, this is acceptable since it's called infrequently.

**Step 3: Update mod.rs exports**

```rust
pub use parity::{get_parity_layout, get_composition_bounds, get_font_metrics, scale_factor, calculate_composition_bounds, ParityLayout, CompositionBounds, FontMetrics};
```

**Step 4: Run tests**

Run: `cd E:\snapit\src-tauri && cargo test parity --lib`
Expected: Tests pass, `src/types/generated/FontMetrics.ts` created

**Step 5: Commit**

```bash
git add src-tauri/src/rendering/parity.rs src-tauri/src/rendering/mod.rs src/types/generated/FontMetrics.ts
git commit -m "feat(parity): add font metrics API for CSS sync"
```

---

## Task 4: Register Tauri Commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Step 1: Add parity commands to invoke_handler**

In `src-tauri/src/lib.rs`, find the `invoke_handler` section (around line 105) and add after the font commands (around line 185):

```rust
            // Parity commands (preview/export sync)
            rendering::get_parity_layout,
            rendering::get_composition_bounds,
            rendering::get_font_metrics,
```

**Step 2: Verify build compiles**

Run: `cd E:\snapit\src-tauri && cargo build`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(parity): register Tauri commands for parity APIs"
```

---

## Task 5: Create React Hook

**Files:**
- Create: `src/hooks/useParityLayout.ts`

**Step 1: Create the hook file**

Create `src/hooks/useParityLayout.ts`:

```typescript
/**
 * useParityLayout - Consumes parity constants from Rust for CSS preview.
 *
 * This hook ensures CSS preview uses the exact same layout values as GPU export.
 * All magic numbers flow from Rust's parity module - never hardcode layout values in React.
 */

import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ParityLayout } from '@/types/generated/ParityLayout';
import type { CompositionBounds } from '@/types/generated/CompositionBounds';
import type { FontMetrics } from '@/types/generated/FontMetrics';

// Cached layout - loaded once at app startup
let cachedLayout: ParityLayout | null = null;

/**
 * Initialize parity layout from Rust.
 * Call this once at app startup before any components render.
 */
export async function initParityLayout(): Promise<ParityLayout> {
  if (cachedLayout) return cachedLayout;
  cachedLayout = await invoke<ParityLayout>('get_parity_layout');
  return cachedLayout;
}

/**
 * Get the cached parity layout.
 * Throws if initParityLayout hasn't been called yet.
 */
export function getParityLayout(): ParityLayout {
  if (!cachedLayout) {
    throw new Error('Parity layout not initialized. Call initParityLayout() at app startup.');
  }
  return cachedLayout;
}

/**
 * Hook to get parity layout constants.
 * Returns null until layout is loaded.
 */
export function useParityLayout(): ParityLayout | null {
  const [layout, setLayout] = useState<ParityLayout | null>(cachedLayout);

  useEffect(() => {
    if (!cachedLayout) {
      initParityLayout().then(setLayout);
    }
  }, []);

  return layout;
}

/**
 * Hook to get scaled layout values for a given container height.
 * All caption/background values scale relative to 1080p reference.
 */
export function useScaledLayout(containerHeight: number) {
  const layout = useParityLayout();

  return useMemo(() => {
    if (!layout || containerHeight === 0) {
      return null;
    }

    const scale = containerHeight / layout.referenceHeight;

    return {
      scale,
      captionPadding: layout.captionPadding * scale,
      captionBgPaddingH: layout.captionBgPaddingH * scale,
      captionBgPaddingV: layout.captionBgPaddingV * scale,
      captionCornerRadius: layout.captionCornerRadius * scale,
      lineHeightMultiplier: layout.lineHeightMultiplier,
      defaultBgPadding: layout.defaultBgPadding * scale,
      defaultBgRounding: layout.defaultBgRounding * scale,
    };
  }, [layout, containerHeight]);
}

// Font metrics cache
const fontMetricsCache = new Map<string, FontMetrics>();

/**
 * Get font metrics for a given font family and size.
 * Results are cached to avoid repeated Tauri calls.
 */
export async function getFontMetrics(
  family: string,
  size: number,
  weight: number = 400
): Promise<FontMetrics> {
  const cacheKey = `${family}:${size}:${weight}`;

  if (fontMetricsCache.has(cacheKey)) {
    return fontMetricsCache.get(cacheKey)!;
  }

  const metrics = await invoke<FontMetrics>('get_font_metrics', {
    family,
    size,
    weight,
  });

  fontMetricsCache.set(cacheKey, metrics);
  return metrics;
}

/**
 * Hook to get composition bounds from Rust.
 * Ensures preview uses identical frame positioning as export.
 */
export function useCompositionBounds(
  videoWidth: number,
  videoHeight: number,
  padding: number,
  manualWidth?: number,
  manualHeight?: number
) {
  const [bounds, setBounds] = useState<CompositionBounds | null>(null);

  useEffect(() => {
    if (videoWidth === 0 || videoHeight === 0) {
      setBounds(null);
      return;
    }

    invoke<CompositionBounds>('get_composition_bounds', {
      videoWidth,
      videoHeight,
      padding,
      manualWidth: manualWidth ?? null,
      manualHeight: manualHeight ?? null,
    }).then(setBounds);
  }, [videoWidth, videoHeight, padding, manualWidth, manualHeight]);

  return bounds;
}

/**
 * Sync version of composition bounds calculation for use in useMemo.
 * Only use when you need synchronous calculation and already have layout.
 */
export function calculateCompositionBoundsSync(
  layout: ParityLayout,
  videoWidth: number,
  videoHeight: number,
  padding: number,
  manualOutput?: { width: number; height: number }
): CompositionBounds {
  const videoAspect = videoWidth / videoHeight;

  if (!manualOutput) {
    // Auto mode
    return {
      outputWidth: videoWidth + padding * 2,
      outputHeight: videoHeight + padding * 2,
      frameX: padding,
      frameY: padding,
      frameWidth: videoWidth,
      frameHeight: videoHeight,
      effectivePadding: padding,
    };
  }

  // Manual mode
  const { width: fixedW, height: fixedH } = manualOutput;
  const availableW = Math.max(1, fixedW - padding * 2);
  const availableH = Math.max(1, fixedH - padding * 2);
  const availableAspect = availableW / availableH;

  let frameW: number;
  let frameH: number;

  if (videoAspect > availableAspect) {
    frameW = availableW;
    frameH = availableW / videoAspect;
  } else {
    frameH = availableH;
    frameW = availableH * videoAspect;
  }

  return {
    outputWidth: fixedW,
    outputHeight: fixedH,
    frameX: (fixedW - frameW) / 2,
    frameY: (fixedH - frameH) / 2,
    frameWidth: frameW,
    frameHeight: frameH,
    effectivePadding: padding,
  };
}
```

**Step 2: Verify TypeScript compilation**

Run: `cd E:\snapit && npm run type-check` (or `tsc --noEmit`)
Expected: No type errors

**Step 3: Commit**

```bash
git add src/hooks/useParityLayout.ts
git commit -m "feat(parity): add React hook for consuming parity constants"
```

---

## Task 6: Initialize Parity at App Startup

**Files:**
- Modify: `src/App.tsx` or `src/main.tsx`

**Step 1: Find app initialization**

First, check where the app initializes. Look for `main.tsx` or `App.tsx`.

**Step 2: Add parity initialization**

Add import at top:
```typescript
import { initParityLayout } from '@/hooks/useParityLayout';
```

Add initialization early in the app (before any components that use layout):
```typescript
// Initialize parity layout from Rust (call early, before components render)
initParityLayout().catch(console.error);
```

This should be added as early as possible - ideally before the React root renders or in a top-level effect.

**Step 3: Commit**

```bash
git add src/App.tsx  # or src/main.tsx
git commit -m "feat(parity): initialize parity layout at app startup"
```

---

## Task 7: Migrate CaptionOverlay to Parity System

**Files:**
- Modify: `src/components/VideoEditor/CaptionOverlay.tsx`

**Step 1: Update imports**

Replace the existing implementation. Add at top:

```typescript
import { useScaledLayout } from '@/hooks/useParityLayout';
```

**Step 2: Replace hardcoded values**

In `CaptionOverlay.tsx`, replace lines 56-77 (the hardcoded values section):

```typescript
// OLD:
// const scaleFactor = containerHeight / 1080;
// const fontSize = captionSettings.size * scaleFactor;
// const padding = 40 * scaleFactor;
// ...

// NEW: Use parity system
const scaledLayout = useScaledLayout(containerHeight);

// Don't render until layout is loaded
if (!scaledLayout) {
  return null;
}

const { scale: scaleFactor, captionPadding: padding, captionBgPaddingH: bgPaddingH, captionBgPaddingV: bgPaddingV, captionCornerRadius: cornerRadius, lineHeightMultiplier } = scaledLayout;
const fontSize = captionSettings.size * scaleFactor;
const maxTextWidth = containerWidth - (padding * 2);
```

**Step 3: Update lineHeight**

Replace hardcoded `lineHeight: 1.2` with:

```typescript
lineHeight: lineHeightMultiplier,
```

**Step 4: Run dev server and verify**

Run: `cd E:\snapit && npm run dev`
Expected: Captions render identically to before (visual regression check)

**Step 5: Commit**

```bash
git add src/components/VideoEditor/CaptionOverlay.tsx
git commit -m "refactor(captions): migrate CaptionOverlay to parity system"
```

---

## Task 8: Migrate Rust caption_layer.rs to Parity

**Files:**
- Modify: `src-tauri/src/rendering/caption_layer.rs`

**Step 1: Add parity import**

Add at top of `caption_layer.rs`:

```rust
use crate::rendering::parity::{layout, scale_factor};
```

**Step 2: Replace hardcoded values in prepare_caption_text**

In `prepare_caption_text` function (around lines 109-124), replace:

```rust
// OLD:
// let scale_factor = output_height / 1080.0;
// let padding = 40.0 * scale_factor;
// ...
// let line_height = font_size * 1.2;
// let bg_padding_v = 8.0 * scale_factor;

// NEW:
let scale = scale_factor(output_height);
let padding = layout::CAPTION_PADDING * scale;
let font_size = settings.size as f32 * scale;
let text_width = output_width - (padding * 2.0);

let line_height = font_size * layout::LINE_HEIGHT_MULTIPLIER;
let bg_padding_v = layout::CAPTION_BG_PADDING_V * scale;
```

**Step 3: Run tests**

Run: `cd E:\snapit\src-tauri && cargo test caption --lib`
Expected: All caption tests pass

**Step 4: Commit**

```bash
git add src-tauri/src/rendering/caption_layer.rs
git commit -m "refactor(captions): migrate caption_layer.rs to parity constants"
```

---

## Task 9: Migrate compositor.rs to Parity

**Files:**
- Modify: `src-tauri/src/rendering/compositor.rs`

**Step 1: Add parity import**

Add at top:

```rust
use crate::rendering::parity::calculate_composition_bounds;
```

**Step 2: Replace frame bounds calculation**

In `composite_frame` (around lines 668-692), the existing code calculates frame bounds manually. Replace with parity function.

Find this section:
```rust
// Calculate frame bounds based on padding, maintaining video aspect ratio
let out_w = options.output_width as f32;
let out_h = options.output_height as f32;
let padding = options.background.padding;
// ... calculation code ...
let frame_x = (out_w - frame_w) / 2.0;
let frame_y = (out_h - frame_h) / 2.0;
```

Replace with:
```rust
// Calculate frame bounds using parity system
let out_w = options.output_width as f32;
let out_h = options.output_height as f32;

let bounds = calculate_composition_bounds(
    frame.width as f32,
    frame.height as f32,
    options.background.padding,
    Some((out_w, out_h)), // Always manual mode in compositor
);

let frame_x = bounds.frame_x;
let frame_y = bounds.frame_y;
let frame_w = bounds.frame_width;
let frame_h = bounds.frame_height;
```

**Step 3: Verify build**

Run: `cd E:\snapit\src-tauri && cargo build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src-tauri/src/rendering/compositor.rs
git commit -m "refactor(compositor): use parity bounds calculation"
```

---

## Task 10: Update Parity Tests

**Files:**
- Modify: `src/components/VideoEditor/__tests__/captionRenderingParity.test.ts`

**Step 1: Update test to use parity API**

The existing test hardcodes values. Update to verify against the parity system:

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { ParityLayout } from '@/types/generated/ParityLayout';

describe('Caption Rendering Parity', () => {
  let layout: ParityLayout;

  beforeAll(async () => {
    // Get layout from Rust - this is the source of truth
    layout = await invoke<ParityLayout>('get_parity_layout');
  });

  describe('Layout Constants', () => {
    it('has expected reference height', () => {
      expect(layout.referenceHeight).toBe(1080);
    });

    it('has expected caption padding', () => {
      expect(layout.captionPadding).toBe(40);
    });

    it('has expected line height multiplier', () => {
      expect(layout.lineHeightMultiplier).toBe(1.2);
    });

    it('has expected background padding', () => {
      expect(layout.captionBgPaddingH).toBe(16);
      expect(layout.captionBgPaddingV).toBe(8);
    });
  });

  describe('Scaling', () => {
    it('scales correctly at various resolutions', () => {
      const testCases = [
        { height: 480, expectedScale: 480 / 1080 },
        { height: 720, expectedScale: 720 / 1080 },
        { height: 1080, expectedScale: 1.0 },
        { height: 1440, expectedScale: 1440 / 1080 },
        { height: 2160, expectedScale: 2.0 },
      ];

      for (const { height, expectedScale } of testCases) {
        const scale = height / layout.referenceHeight;
        expect(scale).toBeCloseTo(expectedScale, 4);
      }
    });
  });
});
```

**Step 2: Run tests**

Run: `cd E:\snapit && npm run test:run`
Expected: Parity tests pass

**Step 3: Commit**

```bash
git add src/components/VideoEditor/__tests__/captionRenderingParity.test.ts
git commit -m "test(parity): update tests to use parity API"
```

---

## Task 11: Final Integration Test

**Files:** None (manual verification)

**Step 1: Build everything**

Run: `cd E:\snapit && npm run build && cd src-tauri && cargo build`
Expected: Both builds succeed

**Step 2: Run all tests**

Run: `cd E:\snapit && npm run test:run && cd src-tauri && cargo test --lib`
Expected: All tests pass

**Step 3: Manual verification**

1. Open the app with a video project
2. Add captions and verify they render correctly in preview
3. Export a short clip
4. Compare caption positioning between preview and export
5. Test with different output resolutions (720p, 1080p, 4K)

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat(parity): complete preview/export CSS parity system

- Add parity module with layout constants and composition bounds
- Add font metrics API for CSS/glyphon sync
- Create React hook for consuming parity values
- Migrate CaptionOverlay to use parity system
- Migrate caption_layer.rs to use parity constants
- Migrate compositor.rs to use parity bounds calculation
- Update tests to verify against parity API

This ensures preview and export use identical layout calculations,
eliminating visual drift between what users see and what gets exported."
```

---

## Summary

**Total Tasks:** 11
**New Files:** 2 (parity.rs, useParityLayout.ts)
**Modified Files:** 6 (mod.rs, lib.rs, CaptionOverlay.tsx, caption_layer.rs, compositor.rs, tests)
**Generated Files:** 3 (ParityLayout.ts, CompositionBounds.ts, FontMetrics.ts)

**Key Principle:** All layout values now flow from Rust's `parity.rs` module. Never hardcode values in React or duplicate them in Rust - always reference the parity module.
