import { describe, expect, it, vi } from 'vitest';

import type { CaptionSegment } from '@/types';

import { parseCaptionEditWindow } from './captions/captionEditTransforms';
import {
  getCaptionErrorMessage,
  getRegenerateDisabledState,
  transcribeWithDownloadedModel,
} from './captions/captionOrchestration';
import { getCompressedWordTimings } from './captions/captionWordTiming';

const SEGMENT: CaptionSegment = {
  id: 'segment-1',
  start: 1,
  end: 3,
  text: 'hello world',
  words: [],
};

describe('CaptionPanel behavior', () => {
  it('parses seconds and normalizes the minimum edit window', () => {
    expect(parseCaptionEditWindow('  hello  ', '-1', '-0.5')).toEqual({
      text: 'hello',
      start: 0,
      end: 0.05,
    });
    expect(parseCaptionEditWindow('hello', 'invalid', '2')).toBeNull();
    expect(
      parseCaptionEditWindow('', '1', '2', { requireText: true })
    ).toBeNull();
    expect(
      parseCaptionEditWindow('hello', '2', '1', { rejectInvalidOrder: true })
    ).toBeNull();
  });

  it('compresses word timings into the selected percentage window', () => {
    expect(
      getCompressedWordTimings(
        [25, 75],
        [0, 100],
        '10',
        '14',
        [
          { text: 'hello', start: 10, end: 12 },
          { text: 'world', start: 12, end: 14 },
        ]
      )
    ).toEqual({
      range: [25, 75],
      words: [
        { text: 'hello', start: '11.00', end: '12.00' },
        { text: 'world', start: '12.00', end: '13.00' },
      ],
    });
  });

  it('disables regeneration when timing is invalid or work is busy', () => {
    expect(
      getRegenerateDisabledState({
        videoPath: 'video.mp4',
        editingSegmentId: SEGMENT.id,
        captionSegments: [SEGMENT],
        hasInvalidSegmentTiming: false,
        isRegeneratingSegment: false,
        isRegeneratingAllSegments: false,
      })
    ).toEqual({
      isRegenerateDisabled: false,
      isRegenerateAllDisabled: false,
    });

    expect(
      getRegenerateDisabledState({
        videoPath: 'video.mp4',
        editingSegmentId: SEGMENT.id,
        captionSegments: [SEGMENT],
        hasInvalidSegmentTiming: true,
        isRegeneratingSegment: false,
        isRegeneratingAllSegments: true,
      })
    ).toEqual({
      isRegenerateDisabled: true,
      isRegenerateAllDisabled: true,
    });
  });

  it('normalizes transcription failures for display', () => {
    expect(getCaptionErrorMessage(new Error('model unavailable'))).toBe('model unavailable');
    expect(getCaptionErrorMessage('download failed')).toBe('download failed');
  });

  it('does not start transcription when model download fails', async () => {
    const downloadModel = vi.fn().mockRejectedValue(new Error('download failed'));
    const startTranscription = vi.fn();

    await expect(
      transcribeWithDownloadedModel({
        videoPath: 'video.mp4',
        isModelDownloaded: false,
        selectedModelName: 'base',
        downloadModel,
        startTranscription,
      })
    ).resolves.toBeUndefined();

    expect(downloadModel).toHaveBeenCalledWith('base');
    expect(startTranscription).not.toHaveBeenCalled();
  });

  it('contains transcription invocation failures at the orchestration boundary', async () => {
    const startTranscription = vi.fn().mockRejectedValue(new Error('transcription failed'));

    await expect(
      transcribeWithDownloadedModel({
        videoPath: 'video.mp4',
        isModelDownloaded: true,
        selectedModelName: 'base',
        downloadModel: vi.fn(),
        startTranscription,
      })
    ).resolves.toBeUndefined();

    expect(startTranscription).toHaveBeenCalledWith('video.mp4');
  });
});
