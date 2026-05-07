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
  LIBRARY_ITEM_SCALE_DEFAULT: 1,
  LIBRARY_ITEM_SCALE_MIN: 0.8,
  LIBRARY_ITEM_SCALE_MAX: 1.35,
  LIBRARY_ITEM_SCALE_STEP: 0.08,
  LIBRARY_ITEM_WIDTH_BASE: 240,
  LIBRARY_ITEM_WIDTH_MIN: 200,
  LIBRARY_ITEM_WIDTH_MAX: 360,
  LIBRARY_GRID_MAX_COLUMNS: 8,
  LIBRARY_SIDEBAR_ITEM_SIZE_DEFAULT: 3,
  LIBRARY_SIDEBAR_ITEM_SIZE_MIN: 1,
  LIBRARY_SIDEBAR_ITEM_SIZE_MAX: 5,
  LIBRARY_SIDEBAR_ITEM_SIZE_STEP: 1,
  LIBRARY_SIDEBAR_ITEM_MIN_WIDTH_BY_SIZE: {
    1: 120,
    2: 160,
    3: 200,
    4: 260,
    5: 340,
  },

  // Embedded image editor library sidebar (percentages of total width)
  IMAGE_EDITOR_SIDEBAR_DEFAULT_SIZE: 16,
  IMAGE_EDITOR_SIDEBAR_MIN_SIZE: 12,
  IMAGE_EDITOR_SIDEBAR_MAX_SIZE: 32,
  /** Collapsed-rail width as a percentage. ~6px on a 1200px window. */
  IMAGE_EDITOR_SIDEBAR_COLLAPSED_SIZE: 0.5,

  // Video editor properties sidebar
  VIDEO_EDITOR_SIDEBAR_WIDTH: 360,
} as const;

export type LayoutConstants = typeof LAYOUT;
