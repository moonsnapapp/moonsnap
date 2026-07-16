import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Download,
  Loader2,
  Mic,
  Trash2,
} from 'lucide-react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../../components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { TRANSCRIPTION_LANGUAGE_OPTIONS } from '../../../constants';
import { cn } from '../../../lib/utils';

const MODEL_SIZES: Record<string, string> = {
  tiny: '~75 MB',
  base: '~140 MB',
  small: '~460 MB',
  medium: '~1.5 GB',
  'large-v3': '~3 GB',
};

const SORTED_TRANSCRIPTION_LANGUAGE_OPTIONS = [...TRANSCRIPTION_LANGUAGE_OPTIONS].sort(
  (left, right) => {
    if (left.value === 'auto') return -1;
    if (right.value === 'auto') return 1;
    return left.label.localeCompare(right.label);
  }
);

interface TranscriptionLanguageComboboxProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

export function TranscriptionLanguageCombobox({
  value,
  onChange,
  className,
  placeholder = 'Select language',
}: TranscriptionLanguageComboboxProps) {
  const [open, setOpen] = useState(false);
  const selectedOption = SORTED_TRANSCRIPTION_LANGUAGE_OPTIONS.find(
    (option) => option.value === value
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-md border border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 text-left text-sm text-[var(--ink-dark)] transition-colors hover:bg-[var(--glass-highlight)]',
            className
          )}
        >
          <span className="truncate">{selectedOption?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-[var(--ink-subtle)]" />
        </button>
      </PopoverTrigger>
      {open && (
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] border-[var(--glass-border)] bg-[var(--glass-surface-dark)] p-0"
        >
          <Command className="bg-transparent text-[var(--ink-dark)]">
            <CommandInput placeholder="Search languages..." className="h-9" />
            <CommandList className="max-h-[260px]">
              <CommandEmpty>No language found.</CommandEmpty>
              <CommandGroup>
                {SORTED_TRANSCRIPTION_LANGUAGE_OPTIONS.map((option) => (
                  <CommandItem
                    key={`transcription-language-${option.value}`}
                    value={`${option.label} ${option.value}`}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="text-sm"
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === option.value ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="truncate">{option.label}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      )}
    </Popover>
  );
}

interface WhisperModelSelectProps {
  value: string;
  models: Array<{ name: string; downloaded: boolean }>;
  onChange: (value: string) => void;
  className?: string;
}

export function WhisperModelSelect({
  value,
  models,
  onChange,
  className,
}: WhisperModelSelectProps) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        className={cn(
          'h-9 border-[var(--glass-border)] bg-[var(--polar-mist)] px-3 text-sm text-[var(--ink-dark)]',
          className
        )}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="border-[var(--glass-border)] bg-[var(--glass-surface-dark)] text-[var(--ink-dark)]">
        {models.map((model) => (
          <SelectItem key={model.name} value={model.name}>
            {`${model.name}${MODEL_SIZES[model.name] ? ` (${MODEL_SIZES[model.name]})` : ''}${
              model.downloaded ? '' : ' - download'
            }`}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export interface TranscriptionControlsProps {
  videoPath: string | null;
  selectedModelName: string;
  whisperModels: Array<{ name: string; downloaded: boolean }>;
  isModelDownloaded: boolean;
  selectedTranscriptionLanguage: string;
  isDownloadingModel: boolean;
  downloadProgress: number;
  isTranscribing: boolean;
  transcriptionStage: string | null;
  transcriptionProgress: number;
  transcriptionError: string | null;
  hasCaptionSegments: boolean;
  onSelectModel: (value: string) => void;
  onSelectLanguage: (value: string) => void;
  onTranscribe: () => void;
  onClearCaptions: () => void;
}

function TranscriptionActionContent({
  isDownloadingModel,
  downloadProgress,
  isTranscribing,
  transcriptionStage,
  transcriptionProgress,
  isModelDownloaded,
  hasCaptionSegments,
}: Pick<
  TranscriptionControlsProps,
  | 'isDownloadingModel'
  | 'downloadProgress'
  | 'isTranscribing'
  | 'transcriptionStage'
  | 'transcriptionProgress'
  | 'isModelDownloaded'
  | 'hasCaptionSegments'
>) {
  const action = getTranscriptionActionState({
    isDownloadingModel,
    downloadProgress,
    isTranscribing,
    transcriptionStage,
    transcriptionProgress,
    isModelDownloaded,
    hasCaptionSegments,
  });

  if (action.icon === 'loading') {
    return (
      <>
        <Loader2 className="w-4 h-4 animate-spin" />
        {action.label}
      </>
    );
  }

  if (action.icon === 'download') {
    return (
      <>
        <Download className="w-4 h-4" />
        {action.label}
      </>
    );
  }

  return (
    <>
      <Mic className="w-4 h-4" />
      {action.label}
    </>
  );
}

function getTranscriptionActionState({
  isDownloadingModel,
  downloadProgress,
  isTranscribing,
  transcriptionStage,
  transcriptionProgress,
  isModelDownloaded,
  hasCaptionSegments,
}: Pick<
  TranscriptionControlsProps,
  | 'isDownloadingModel'
  | 'downloadProgress'
  | 'isTranscribing'
  | 'transcriptionStage'
  | 'transcriptionProgress'
  | 'isModelDownloaded'
  | 'hasCaptionSegments'
>) {
  if (isDownloadingModel) {
    return {
      icon: 'loading' as const,
      label: `Downloading... ${Math.round(downloadProgress)}%`,
    };
  }

  if (isTranscribing) {
    return {
      icon: 'loading' as const,
      label: getTranscriptionProgressLabel(transcriptionStage, transcriptionProgress),
    };
  }

  if (!isModelDownloaded) {
    return { icon: 'download' as const, label: 'Download & Transcribe' };
  }

  return {
    icon: 'mic' as const,
    label: getTranscribeActionLabel(hasCaptionSegments),
  };
}

function getTranscriptionProgressLabel(stage: string | null, progress: number) {
  return stage === 'extracting_audio'
    ? 'Extracting audio...'
    : `Transcribing... ${Math.round(progress)}%`;
}

function getTranscribeActionLabel(hasCaptionSegments: boolean) {
  return hasCaptionSegments ? 'Re-transcribe' : 'Transcribe Audio';
}

function getModelDownloadStatusLabel(isModelDownloaded: boolean) {
  return isModelDownloaded ? 'Model downloaded' : 'Downloads on transcribe';
}

function ClearCaptionsButton({
  hasCaptionSegments,
  isBusy,
  onClearCaptions,
}: Pick<TranscriptionControlsProps, 'hasCaptionSegments' | 'onClearCaptions'> & {
  isBusy: boolean;
}) {
  if (!hasCaptionSegments) return null;

  return (
    <button
      type="button"
      onClick={onClearCaptions}
      disabled={isBusy}
      className="editor-choice-pill flex items-center justify-center gap-2 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <Trash2 className="w-4 h-4" />
      Clear
    </button>
  );
}

function TranscriptionErrorMessage({ error }: { error: string | null }) {
  if (!error) return null;

  return (
    <div className="mt-2 flex items-start gap-2 p-2 bg-[var(--error-light)] rounded-md">
      <AlertCircle className="w-4 h-4 text-[var(--error)] flex-shrink-0 mt-0.5" />
      <span className="text-xs text-[var(--error)]">{error}</span>
    </div>
  );
}

export function TranscriptionControls({
  videoPath,
  selectedModelName,
  whisperModels,
  isModelDownloaded,
  selectedTranscriptionLanguage,
  isDownloadingModel,
  downloadProgress,
  isTranscribing,
  transcriptionStage,
  transcriptionProgress,
  transcriptionError,
  hasCaptionSegments,
  onSelectModel,
  onSelectLanguage,
  onTranscribe,
  onClearCaptions,
}: TranscriptionControlsProps) {
  const isBusy = isTranscribing || isDownloadingModel;

  return (
    <div className="pt-3 border-t border-[var(--glass-border)]">
      <div className="flex items-center gap-2 mb-3">
        <Mic className="w-4 h-4 text-[var(--ink-muted)]" />
        <span className="text-[11px] text-[var(--ink-subtle)] uppercase tracking-wide">
          Transcription
        </span>
      </div>

      <div className="mb-3">
        <WhisperModelSelect
          value={selectedModelName}
          models={whisperModels}
          onChange={onSelectModel}
          className="w-full"
        />
        <div className="mt-1 text-[10px] text-[var(--ink-subtle)]">
          {getModelDownloadStatusLabel(isModelDownloaded)}
        </div>
      </div>

      <div className="mb-3">
        <label className="text-xs text-[var(--ink-muted)] block mb-1">
          Language
        </label>
        <TranscriptionLanguageCombobox
          value={selectedTranscriptionLanguage}
          onChange={onSelectLanguage}
        />
      </div>

      <div className="flex gap-1.5">
        <button
          onClick={onTranscribe}
          disabled={!videoPath || isBusy}
          className="editor-choice-pill editor-choice-pill--active flex-1 flex items-center justify-center gap-2 px-2 py-2 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <TranscriptionActionContent
            isDownloadingModel={isDownloadingModel}
            downloadProgress={downloadProgress}
            isTranscribing={isTranscribing}
            transcriptionStage={transcriptionStage}
            transcriptionProgress={transcriptionProgress}
            isModelDownloaded={isModelDownloaded}
            hasCaptionSegments={hasCaptionSegments}
          />
        </button>
        <ClearCaptionsButton
          hasCaptionSegments={hasCaptionSegments}
          isBusy={isBusy}
          onClearCaptions={onClearCaptions}
        />
      </div>

      <TranscriptionErrorMessage error={transcriptionError} />
    </div>
  );
}
