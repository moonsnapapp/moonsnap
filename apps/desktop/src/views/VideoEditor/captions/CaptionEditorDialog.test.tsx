import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CaptionSegment } from '@/types';

import { CaptionEditorDialog } from './CaptionEditorDialog';

vi.mock('../../../components/VideoEditor/CaptionOverlay', () => ({
  CaptionOverlay: () => null,
}));

const SEGMENT: CaptionSegment = {
  id: 'segment-1',
  start: 1,
  end: 3,
  text: 'hello world',
  words: [
    { text: 'hello', start: 1, end: 2 },
    { text: 'world', start: 2, end: 3 },
  ],
};

function createDialogProps(
  overrides: Partial<ComponentProps<typeof CaptionEditorDialog>> = {}
): ComponentProps<typeof CaptionEditorDialog> {
  return {
    isEditorOpen: true,
    onOpenChange: vi.fn(),
    displayCaptionSegments: [SEGMENT],
    captionSegments: [SEGMENT],
    editingSegmentId: SEGMENT.id,
    isSegmentDirty: () => false,
    onAuditionSegment: vi.fn(),
    onResetSegment: vi.fn(),
    projectDurationSeconds: 5,
    onTogglePlayback: vi.fn(),
    onBeginPlaybackScrub: vi.fn(),
    playbackTimelineRef: { current: null },
    captionPreviewHostRef: { current: null },
    captionPreviewDisplayWidth: 720,
    captionPreviewCropDisplayHeight: 100,
    captionPreviewOffsetX: 0,
    captionPreviewScaledWidth: 720,
    captionPreviewDisplayHeight: 405,
    captionPreviewCropOffsetY: 305,
    captionPreviewScale: 0.375,
    previewSourceWidth: 1920,
    previewSourceHeight: 1080,
    selectedEditingSegment: SEGMENT,
    editingStart: '1.00',
    editingEnd: '3.00',
    editingText: SEGMENT.text,
    onEditingStartChange: vi.fn(),
    onEditingEndChange: vi.fn(),
    onEditingTextChange: vi.fn(),
    timelineSegmentStart: 1,
    timelineDuration: 2,
    wordCompressionRange: [0, 100],
    onBeginLocalTimelineScrub: vi.fn(),
    localTimelineRef: { current: null },
    applyWordCompressionRange: vi.fn(),
    wordTimelineRef: { current: null },
    editingWords: [
      { text: 'hello', start: '1.00', end: '2.00' },
      { text: 'world', start: '2.00', end: '3.00' },
    ],
    wordDragState: null,
    startWordDrag: vi.fn(),
    updateEditingWordTiming: vi.fn(),
    syncWordsFromText: vi.fn(),
    hasInvalidWordTiming: false,
    regenerateModelName: 'base',
    whisperModels: [{ name: 'base', downloaded: true }],
    onRegenerateModelChange: vi.fn(),
    isRegenerateModelDownloaded: true,
    selectedTranscriptionLanguage: 'auto',
    onSelectedTranscriptionLanguageChange: vi.fn(),
    onCancelEditingSegment: vi.fn(),
    onRegenerateEditingSegment: vi.fn(),
    isRegenerateDisabled: false,
    isRegeneratingSegment: false,
    onRegenerateAllSegments: vi.fn(),
    isRegenerateAllDisabled: false,
    isRegeneratingAllSegments: false,
    transcriptionProgress: 0,
    onUndoLastRegenerate: vi.fn(),
    lastRegenSnapshot: null,
    onSaveEditingSegment: vi.fn(),
    isSaveDisabled: false,
    segmentRegenerateError: null,
    ...overrides,
  };
}

describe('CaptionEditorDialog', () => {
  it('dispatches save from the selected segment editor', () => {
    const onSaveEditingSegment = vi.fn();
    render(
      <CaptionEditorDialog
        {...createDialogProps({ onSaveEditingSegment })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save Segment' }));

    expect(onSaveEditingSegment).toHaveBeenCalledTimes(1);
  });

  it('dispatches cancel without saving the selected segment', () => {
    const onCancelEditingSegment = vi.fn();
    const onSaveEditingSegment = vi.fn();
    render(
      <CaptionEditorDialog
        {...createDialogProps({ onCancelEditingSegment, onSaveEditingSegment })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Clear Selection' }));

    expect(onCancelEditingSegment).toHaveBeenCalledTimes(1);
    expect(onSaveEditingSegment).not.toHaveBeenCalled();
  });
});
