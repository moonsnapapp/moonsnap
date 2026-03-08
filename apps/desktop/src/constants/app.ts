export const APP = {
  NAME: 'MoonSnap',
  FEEDBACK_API: 'https://moonsnap-feedback.walterlow88.workers.dev/feedback',
} as const;

export type AppConstants = typeof APP;
