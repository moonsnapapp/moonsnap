/**
 * Shared transcription defaults and language options.
 */
export const TRANSCRIPTION = {
  AUTO_LANGUAGE: 'auto',
  DEFAULT_LANGUAGE: 'en',
  DEFAULT_MODEL: 'small',
  CANCELLED_MESSAGE: 'Transcription cancelled.',
  LANGUAGES: [
    { value: 'en', label: 'English' },
    { value: 'zh', label: 'Chinese' },
    { value: 'ja', label: 'Japanese' },
    { value: 'ko', label: 'Korean' },
    { value: 'es', label: 'Spanish' },
    { value: 'fr', label: 'French' },
    { value: 'de', label: 'German' },
    { value: 'pt', label: 'Portuguese' },
    { value: 'ru', label: 'Russian' },
    { value: 'auto', label: 'Auto Detect (less reliable)' },
  ],
} as const;

export type TranscriptionConstants = typeof TRANSCRIPTION;
export type TranscriptionLanguageOption = (typeof TRANSCRIPTION.LANGUAGES)[number];
