import { beforeEach, describe, expect, it } from 'vitest';
import type { CaptionData } from '@/types';
import { clearInvokeResponses, setInvokeResponse } from '@/test/mocks/tauri';
import { DEFAULT_CAPTION_SETTINGS } from './captionSlice';
import { useVideoEditorStore } from './index';

const TRANSCRIBED_CAPTIONS: CaptionData = {
  segments: [
    {
      id: 'segment-1',
      start: 0,
      end: 1.5,
      text: 'hello world',
      words: [
        { text: 'hello', start: 0, end: 0.75 },
        { text: 'world', start: 0.75, end: 1.5 },
      ],
    },
  ],
  settings: {
    ...DEFAULT_CAPTION_SETTINGS,
    color: '#000000',
    highlightColor: '#00FF00',
  },
};

describe('captionSlice', () => {
  beforeEach(() => {
    clearInvokeResponses();
    useVideoEditorStore.getState().clearEditor();
    useVideoEditorStore.setState({
      captionSegments: [],
      captionSettings: { ...DEFAULT_CAPTION_SETTINGS },
      isDownloadingModel: false,
      downloadProgress: 0,
      transcriptionProgress: 0,
      transcriptionStage: '',
      transcriptionMessage: '',
      transcriptionError: null,
    });
  });

  it('preserves existing caption styling when transcription completes', async () => {
    setInvokeResponse('transcribe_video', TRANSCRIBED_CAPTIONS);
    useVideoEditorStore.setState({
      captionSettings: {
        ...DEFAULT_CAPTION_SETTINGS,
        enabled: false,
        color: '#123456',
        highlightColor: '#ABCDEF',
        backgroundOpacity: 35,
        exportWithSubtitles: true,
      },
    });

    await useVideoEditorStore.getState().startTranscription('C:/tmp/screen.mp4');

    const { captionSegments, captionSettings } = useVideoEditorStore.getState();
    expect(captionSegments).toEqual(TRANSCRIBED_CAPTIONS.segments);
    expect(captionSettings).toMatchObject({
      enabled: true,
      color: '#123456',
      highlightColor: '#ABCDEF',
      backgroundOpacity: 35,
      exportWithSubtitles: true,
    });
  });

  it('clamps download progress updates to a valid percentage range', () => {
    useVideoEditorStore.getState().setDownloadProgress(42.5);
    expect(useVideoEditorStore.getState().downloadProgress).toBe(42.5);

    useVideoEditorStore.getState().setDownloadProgress(140);
    expect(useVideoEditorStore.getState().downloadProgress).toBe(100);

    useVideoEditorStore.getState().setDownloadProgress(-10);
    expect(useVideoEditorStore.getState().downloadProgress).toBe(0);
  });
});
