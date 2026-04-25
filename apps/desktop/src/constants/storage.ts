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
} as const;

export type StorageConstants = typeof STORAGE;
