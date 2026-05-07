export type SharedBackgroundType = 'wallpaper' | 'image' | 'solid' | 'gradient';

interface BackgroundTypeTabsProps {
  currentType: SharedBackgroundType;
  onTypeChange: (type: SharedBackgroundType) => void;
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
}: BackgroundTypeTabsProps) {
  return (
    <div className="min-w-0">
      <span className="text-xs text-[var(--ink-muted)] block mb-2">Background Type</span>
      <div className="grid min-w-0 grid-cols-4 gap-1.5">
        {BACKGROUND_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onTypeChange(type)}
            className={`editor-choice-pill min-w-0 px-1.5 py-2 text-xs ${
              currentType === type ? 'editor-choice-pill--active' : ''
            }`}
          >
            <div className="flex min-w-0 items-center justify-center gap-1">
              {type === 'wallpaper' && (
                <div className="h-3 w-3 shrink-0 rounded-sm bg-gradient-to-br from-blue-400 to-purple-500" />
              )}
              <span className="min-w-0 truncate capitalize">{type}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
