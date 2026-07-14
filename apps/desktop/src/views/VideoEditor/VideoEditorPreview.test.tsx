import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VideoEditorPreview } from './VideoEditorPreview';

vi.mock('../../components/VideoEditor/GPUVideoPreview', () => ({
  GPUVideoPreview: () => <div>Video preview</div>,
}));

vi.mock('../../components/VideoEditor/GPUErrorBoundary', () => ({
  GPUErrorBoundary: ({ children }: { children: React.ReactNode }) => children,
}));

const captureNavigation = {
  canGoPrevious: true,
  canGoNext: true,
  onGoPrevious: vi.fn(),
  onGoNext: vi.fn(),
};

describe('VideoEditorPreview', () => {
  it('shows capture navigation outside crop mode', () => {
    render(<VideoEditorPreview captureNavigation={captureNavigation} />);

    expect(screen.getByRole('button', { name: 'Previous capture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next capture' })).toBeInTheDocument();
  });

  it('hides capture navigation during crop mode', () => {
    render(
      <VideoEditorPreview
        isCropEditing
        captureNavigation={captureNavigation}
      />
    );

    expect(screen.queryByRole('button', { name: 'Previous capture' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next capture' })).not.toBeInTheDocument();
  });
});
