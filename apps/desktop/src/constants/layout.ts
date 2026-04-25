/**
 * Layout constants for the Library grid system.
 * These values must be consistent across CaptureLibrary and VirtualizedGrid.
 */

// Grid layout
export const LAYOUT = {
  // Header and spacing
  HEADER_HEIGHT: 56,
  GRID_GAP: 20,
  CONTAINER_PADDING: 64,

  // Capture toolbar
  CAPTURE_TOOLBAR_STARTUP_WIDTH: 738,
  CAPTURE_TOOLBAR_STARTUP_HEIGHT: 147,
  RECORDING_HUD_WIDTH: 360,
  RECORDING_HUD_HEIGHT: 60,
  FLOATING_WINDOW_EDGE_MARGIN: 16,
  FLOATING_SELECTION_GAP: 8,
  FLOATING_WINDOW_BOTTOM_OFFSET: 100,

  // Card dimensions
  CARD_ROW_HEIGHT: 280,
  LIST_ROW_HEIGHT: 88, // 56px thumbnail + 24px padding (12px*2) + 8px gap
  MIN_CARD_WIDTH: 240,
  CARD_THUMBNAIL_ASPECT_RATIO: 16 / 9,

  // Embedded image editor library sidebar
  IMAGE_EDITOR_SIDEBAR_DEFAULT_SIZE: 16,
  IMAGE_EDITOR_SIDEBAR_MIN_SIZE: 12,
  IMAGE_EDITOR_SIDEBAR_MAX_SIZE: 32,
} as const;

export type LayoutConstants = typeof LAYOUT;
