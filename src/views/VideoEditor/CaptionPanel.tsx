/**
 * CaptionPanel - Panel for caption transcription and editing.
 * Provides transcription controls, segment list, and settings.
 */
import { useEffect, useState } from 'react';
import { Mic, Download, Loader2, AlertCircle, Check } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { useVideoEditorStore } from '../../stores/videoEditorStore';
import { Button } from '../../components/ui/button';
import { Slider } from '../../components/ui/slider';
import type { TranscriptionProgress, DownloadProgress } from '../../types';

interface CaptionPanelProps {
  videoPath: string | null;
}

const MODEL_SIZES: Record<string, string> = {
  tiny: '~75 MB',
  base: '~140 MB',
  small: '~460 MB',
  medium: '~1.5 GB',
  'large-v3': '~3 GB',
};

export function CaptionPanel({ videoPath }: CaptionPanelProps) {
  const {
    captionSegments,
    captionSettings,
    isTranscribing,
    transcriptionProgress,
    transcriptionStage,
    transcriptionError,
    whisperModels,
    selectedModelName,
    isDownloadingModel,
    downloadProgress,
    loadWhisperModels,
    setSelectedModel,
    downloadModel,
    startTranscription,
    updateCaptionSettings,
    setCaptionsEnabled,
    setTranscriptionProgress,
  } = useVideoEditorStore();

  const [showModelSelector, setShowModelSelector] = useState(false);

  // Load models on mount
  useEffect(() => {
    loadWhisperModels();
  }, [loadWhisperModels]);

  // Listen for progress events
  useEffect(() => {
    const unlistenTranscription = listen<TranscriptionProgress>(
      'transcription-progress',
      (event) => {
        setTranscriptionProgress(event.payload.progress, event.payload.stage);
      }
    );

    const unlistenDownload = listen<DownloadProgress>(
      'whisper-download-progress',
      (event) => {
        // Download progress is handled via store state
        console.log('Download progress:', event.payload);
      }
    );

    return () => {
      unlistenTranscription.then((fn) => fn());
      unlistenDownload.then((fn) => fn());
    };
  }, [setTranscriptionProgress]);

  const selectedModel = whisperModels.find((m) => m.name === selectedModelName);
  const isModelDownloaded = selectedModel?.downloaded ?? false;

  const handleTranscribe = async () => {
    if (!videoPath) return;

    if (!isModelDownloaded) {
      // Download first
      try {
        await downloadModel(selectedModelName);
      } catch (error) {
        console.error('Failed to download model:', error);
        return;
      }
    }

    try {
      await startTranscription(videoPath);
    } catch (error) {
      console.error('Transcription failed:', error);
    }
  };

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-4">
      {/* Enable/Disable Toggle */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-[var(--ink-muted)]">Show Captions</span>
        <button
          onClick={() => setCaptionsEnabled(!captionSettings.enabled)}
          className={`relative w-10 h-5 rounded-full transition-colors ${
            captionSettings.enabled
              ? 'bg-[var(--coral-400)]'
              : 'bg-[var(--polar-frost)]'
          }`}
        >
          <span
            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              captionSettings.enabled ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>

      {/* Transcription Section */}
      <div className="pt-3 border-t border-[var(--glass-border)]">
        <div className="flex items-center gap-2 mb-3">
          <Mic className="w-4 h-4 text-[var(--ink-muted)]" />
          <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
            Transcription
          </span>
        </div>

        {/* Model Selector */}
        <div className="mb-3">
          <button
            onClick={() => setShowModelSelector(!showModelSelector)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[var(--polar-mist)] border border-[var(--glass-border)] rounded-md text-sm text-[var(--ink-dark)] hover:bg-[var(--glass-highlight)] transition-colors"
          >
            <span className="flex items-center gap-2">
              <span>{selectedModelName}</span>
              {isModelDownloaded ? (
                <Check className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <Download className="w-3.5 h-3.5 text-[var(--ink-subtle)]" />
              )}
            </span>
            <span className="text-xs text-[var(--ink-subtle)]">
              {MODEL_SIZES[selectedModelName] || ''}
            </span>
          </button>

          {showModelSelector && (
            <div className="mt-1 bg-[var(--glass-surface-dark)] border border-[var(--glass-border)] rounded-md overflow-hidden">
              {whisperModels.map((model) => (
                <button
                  key={model.name}
                  onClick={() => {
                    setSelectedModel(model.name);
                    setShowModelSelector(false);
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--glass-highlight)] transition-colors ${
                    model.name === selectedModelName
                      ? 'bg-[var(--coral-50)] text-[var(--coral-400)]'
                      : 'text-[var(--ink-dark)]'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span>{model.name}</span>
                    {model.downloaded && (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    )}
                  </span>
                  <span className="text-xs text-[var(--ink-subtle)]">
                    {MODEL_SIZES[model.name] || ''}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Transcribe Button */}
        <Button
          onClick={handleTranscribe}
          disabled={!videoPath || isTranscribing || isDownloadingModel}
          className="w-full"
          variant={captionSegments.length > 0 ? 'outline' : 'default'}
        >
          {isDownloadingModel ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Downloading... {Math.round(downloadProgress)}%
            </>
          ) : isTranscribing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              {transcriptionStage === 'extracting_audio'
                ? 'Extracting audio...'
                : `Transcribing... ${Math.round(transcriptionProgress)}%`}
            </>
          ) : !isModelDownloaded ? (
            <>
              <Download className="w-4 h-4 mr-2" />
              Download & Transcribe
            </>
          ) : captionSegments.length > 0 ? (
            <>
              <Mic className="w-4 h-4 mr-2" />
              Re-transcribe
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 mr-2" />
              Transcribe Audio
            </>
          )}
        </Button>

        {/* Error Display */}
        {transcriptionError && (
          <div className="mt-2 flex items-start gap-2 p-2 bg-[var(--error-light)] rounded-md">
            <AlertCircle className="w-4 h-4 text-[var(--error)] flex-shrink-0 mt-0.5" />
            <span className="text-xs text-[var(--error)]">
              {transcriptionError}
            </span>
          </div>
        )}
      </div>

      {/* Segments List */}
      {captionSegments.length > 0 && (
        <div className="pt-3 border-t border-[var(--glass-border)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
              Segments ({captionSegments.length})
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto space-y-1">
            {captionSegments.slice(0, 20).map((segment) => (
              <div
                key={segment.id}
                className="px-2 py-1.5 bg-[var(--polar-mist)] rounded text-xs"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[var(--ink-subtle)] font-mono">
                    {formatTime(segment.start)} - {formatTime(segment.end)}
                  </span>
                </div>
                <p className="text-[var(--ink-dark)] line-clamp-2">
                  {segment.text}
                </p>
              </div>
            ))}
            {captionSegments.length > 20 && (
              <p className="text-[10px] text-[var(--ink-subtle)] text-center py-1">
                +{captionSegments.length - 20} more segments
              </p>
            )}
          </div>
        </div>
      )}

      {/* Style Settings */}
      {captionSegments.length > 0 && (
        <div className="pt-3 border-t border-[var(--glass-border)] space-y-3">
          <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide block">
            Style
          </span>

          {/* Font Size */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--ink-muted)]">Font Size</span>
              <span className="text-xs text-[var(--ink-dark)] font-mono">
                {captionSettings.size}px
              </span>
            </div>
            <Slider
              value={[captionSettings.size]}
              onValueChange={(values) =>
                updateCaptionSettings({ size: values[0] })
              }
              min={16}
              max={64}
              step={2}
            />
          </div>

          {/* Text Color */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-muted)]">Text Color</span>
            <input
              type="color"
              value={captionSettings.color}
              onChange={(e) => updateCaptionSettings({ color: e.target.value })}
              className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
            />
          </div>

          {/* Highlight Color */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--ink-muted)]">
              Highlight Color
            </span>
            <input
              type="color"
              value={captionSettings.highlightColor}
              onChange={(e) =>
                updateCaptionSettings({ highlightColor: e.target.value })
              }
              className="w-8 h-6 rounded border border-[var(--glass-border)] cursor-pointer bg-transparent"
            />
          </div>

          {/* Position */}
          <div>
            <span className="text-xs text-[var(--ink-muted)] block mb-2">
              Position
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => updateCaptionSettings({ position: 'top' })}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  captionSettings.position === 'top'
                    ? 'bg-[var(--coral-100)] text-[var(--coral-400)]'
                    : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] hover:bg-[var(--glass-highlight)]'
                }`}
              >
                Top
              </button>
              <button
                onClick={() => updateCaptionSettings({ position: 'bottom' })}
                className={`flex-1 px-3 py-1.5 text-xs rounded-md transition-colors ${
                  captionSettings.position === 'bottom'
                    ? 'bg-[var(--coral-100)] text-[var(--coral-400)]'
                    : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] hover:bg-[var(--glass-highlight)]'
                }`}
              >
                Bottom
              </button>
            </div>
          </div>

          {/* Background Opacity */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-[var(--ink-muted)]">
                Background Opacity
              </span>
              <span className="text-xs text-[var(--ink-dark)] font-mono">
                {captionSettings.backgroundOpacity}%
              </span>
            </div>
            <Slider
              value={[captionSettings.backgroundOpacity]}
              onValueChange={(values) =>
                updateCaptionSettings({ backgroundOpacity: values[0] })
              }
              min={0}
              max={100}
              step={5}
            />
          </div>
        </div>
      )}
    </div>
  );
}
