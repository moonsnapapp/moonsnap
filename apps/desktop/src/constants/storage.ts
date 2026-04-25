/**
 * Storage and cache constants for stores.
 * Centralizing these prevents magic numbers and enables tuning.
 */

export const STORAGE = {
  // Editor history limits
  HISTORY_LIMIT: 50,
  HISTORY_MEMORY_LIMIT_BYTES: 50 * 1024 * 1024, // 50MB max memory for history

  // Library cache configuration
  LIBRARY_CACHE_KEY: 'moonsnap_library_cache',
  LIBRARY_CACHE_TIMESTAMP_KEY: 'moonsnap_library_cache_timestamp',
  CACHE_MAX_AGE_MS: 5 * 60 * 1000, // 5 minutes - after this, show stale indicator

  // Editor session persistence (survives F5 refresh)
  SESSION_VIEW_KEY: 'moonsnap_session_view',
  SESSION_PROJECT_ID_KEY: 'moonsnap_session_project_id',
  SESSION_VIDEO_PROJECT_PATH_KEY: 'moonsnap_session_video_project_path',

  // Layout preferences
  IMAGE_EDITOR_SIDEBAR_SIZE_KEY: 'moonsnap_image_editor_sidebar_size',
  IMAGE_EDITOR_SIDEBAR_WIDTH_PX_KEY: 'moonsnap_image_editor_sidebar_width_px',
  LIBRARY_ITEM_SCALE_KEY: 'moonsnap_library_item_scale',
  LIBRARY_SIDEBAR_ITEM_SIZE_KEY: 'moonsnap_library_sidebar_item_size',
  LIBRARY_SIDEBAR_CARD_MAX_KEY: 'moonsnap_library_sidebar_card_max',
} as const;

export type StorageConstants = typeof STORAGE;
