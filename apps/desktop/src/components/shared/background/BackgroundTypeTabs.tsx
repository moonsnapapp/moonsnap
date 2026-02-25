import { Upload } from 'lucide-react';

export type SharedBackgroundType = 'wallpaper' | 'image' | 'solid' | 'gradient';

interface BackgroundTypeTabsProps {
  currentType: SharedBackgroundType;
  onTypeChange: (type: SharedBackgroundType) => void;
  gradientAngle: number;
  gradientStart: string;
  gradientEnd: string;
  solidColor: string;
}

const BACKGROUND_TYPES: SharedBackgroundType[] = [
  'wallpaper',
  'image',
  'solid',
  'gradient',
];

export function BackgroundTypeTabs({
  currentType,
  onTypeChange,
  gradientAngle,
  gradientStart,
  gradientEnd,
  solidColor,
}: BackgroundTypeTabsProps) {
  return (
    <div>
      <span className="text-xs text-[var(--ink-muted)] block mb-2">Background Type</span>
      <div className="grid grid-cols-4 gap-1.5">
        {BACKGROUND_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onTypeChange(type)}
            className={`px-2 py-2 text-xs rounded-md transition-colors ${
              currentType === type
                ? 'bg-[var(--coral-100)] text-[var(--coral-500)] border border-[var(--coral-300)]'
                : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] border border-[var(--glass-border)] hover:bg-[var(--polar-frost)]'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              {type === 'gradient' && (
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{
                    background: `linear-gradient(${gradientAngle}deg, ${gradientStart}, ${gradientEnd})`,
                  }}
                />
              )}
              {type === 'solid' && (
                <div
                  className="w-3 h-3 rounded-sm border border-[var(--glass-border)]"
                  style={{ backgroundColor: solidColor }}
                />
              )}
              {type === 'wallpaper' && (
                <div className="w-3 h-3 rounded-sm bg-gradient-to-br from-blue-400 to-purple-500" />
              )}
              {type === 'image' && (
                <div className="w-3 h-3 rounded-sm bg-[var(--ink-faint)] flex items-center justify-center">
                  <Upload className="w-2 h-2" />
                </div>
              )}
              <span className="capitalize">{type}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
