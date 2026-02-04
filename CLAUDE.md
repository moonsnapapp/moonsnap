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

## Bug Investigation

Before diving into debugging:

1. **Capture state first** - `git status`, `git log --oneline -5`, any error messages
2. **Create hypotheses** - List 2-3 possible causes as TODO items
3. **Test systematically** - One hypothesis at a time, document findings
4. **Always summarize** - Use `/diagnose` skill for structured investigations

## Rust Development

- `cargo check` runs automatically after editing `.rs` files (via PostToolUse hook)
- Type mismatches are caught immediately - fix before continuing
- Regenerate TS types: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib`

## Crop & Overlay Positioning

### CSS Crop is NOT Pixel-Perfect
The preview uses CSS `object-fit: cover` + `object-position` for crop visualization. This is an **approximation** that depends on container aspect ratio.

- `object-fit: cover` scales video to FILL container, may clip content
- Actual visible region ≠ crop pixel coordinates when aspect ratios differ
- Any overlay (cursor, clicks, masks) must match CSS behavior, not crop pixels

### Coordinate Spaces (Cursor/Overlays)
1. **Recording coordinates**: Normalized 0-1 relative to capture region dimensions
2. **Video coordinates**: May differ from recording (FFmpeg may adjust dimensions)
3. **Crop coordinates**: Pixel values in video space
4. **CSS-visible coordinates**: What's actually shown after `object-fit: cover`

### When Adding Crop Support to Overlays
Calculate the actual CSS-visible region, not the crop pixel region:
```typescript
// Video wider than crop → scaled by height, horizontal clipping
if (videoAspect > cropAspect) {
  visibleW = videoHeight * cropAspect;
  visibleX = (videoWidth - visibleW) * objectPositionXPercent;
}
// Transform overlay coords to visible region
overlayX = (pixelX - visibleX) / visibleW;
```

### Testing Crop Features
- Test with **non-centered** crops (not just centered 1:1)
- Test with **different aspect ratios** (16:9 video → 1:1, 4:3, 9:16 crops)
- Verify overlay alignment with actual video content (context menus, buttons)

### Key Files
- `CursorOverlay.tsx` - Frontend cursor positioning with crop transform; SVG rasterization at exact size
- `GPUVideoPreview.tsx` - CSS crop via `object-fit: cover` + `object-position`
- `editor_instance.rs` - Backend frame cropping for export parity
- `exporter/mod.rs` - Backend cursor compositing with crop-aware coordinate transform

### Lossless Preview Rendering
- SVG cursors are rasterized at **exact target size** (not pre-rasterized and scaled)
- Cache keys must include size: `__svg_${shape}_${targetHeight}__`
- Export and preview should use same rasterization approach for WYSIWYG

## Workflow Conventions

- **Multi-step tasks**: Create TODO lists to track progress
- **Unclear scope**: Ask clarifying questions before starting
- **Investigations**: Use `/diagnose` for structured bug hunting

## Detailed Guides

See [AGENTS.md](./AGENTS.md) for comprehensive patterns, conventions, and debugging tips.
