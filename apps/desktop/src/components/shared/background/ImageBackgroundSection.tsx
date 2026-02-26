import { Upload, X } from 'lucide-react';

interface FileInputUploader {
  mode: 'file-input';
  emptyLabel: string;
  onFileSelect: (file: File) => void;
}

interface ButtonUploader {
  mode: 'button';
  emptyLabel: string;
  onPick: () => void | Promise<void>;
}

export type ImageUploader = FileInputUploader | ButtonUploader;

interface ImageBackgroundSectionProps {
  imageSrc: string | null;
  onRemove: () => void;
  uploader: ImageUploader;
}

export function ImageBackgroundSection({
  imageSrc,
  onRemove,
  uploader,
}: ImageBackgroundSectionProps) {
  return (
    <div className="space-y-3">
      {imageSrc ? (
        <div className="relative rounded-lg overflow-hidden border border-[var(--glass-border)]">
          <img
            src={imageSrc}
            alt="Custom background"
            className="w-full h-32 object-cover"
          />
          <button
            onClick={onRemove}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
          >
            <X className="w-3.5 h-3.5 text-white" />
          </button>
        </div>
      ) : uploader.mode === 'file-input' ? (
        <label className="flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed border-[var(--glass-border)] bg-[var(--polar-mist)] cursor-pointer hover:border-[var(--coral-300)] hover:bg-[var(--coral-50)] transition-colors">
          <Upload className="w-5 h-5 text-[var(--ink-muted)] mb-1" />
          <span className="text-xs text-[var(--ink-muted)]">{uploader.emptyLabel}</span>
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                uploader.onFileSelect(file);
              }
            }}
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => {
            void uploader.onPick();
          }}
          className="w-full flex flex-col items-center justify-center h-24 rounded-lg border-2 border-dashed border-[var(--glass-border)] bg-[var(--polar-mist)] hover:border-[var(--coral-300)] hover:bg-[var(--coral-50)] transition-colors"
        >
          <Upload className="w-5 h-5 text-[var(--ink-muted)] mb-1" />
          <span className="text-xs text-[var(--ink-muted)]">{uploader.emptyLabel}</span>
        </button>
      )}
    </div>
  );
}
