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
    <div>
      <span className="text-xs text-[var(--ink-muted)] block mb-2">Background Type</span>
      <div className="grid grid-cols-4 gap-1.5">
        {BACKGROUND_TYPES.map((type) => (
          <button
            key={type}
            onClick={() => onTypeChange(type)}
            className={`editor-choice-pill px-2 py-2 text-xs ${
              currentType === type ? 'editor-choice-pill--active' : ''
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              {type === 'wallpaper' && (
                <div className="w-3 h-3 rounded-sm bg-gradient-to-br from-blue-400 to-purple-500" />
              )}
              <span className="capitalize">{type}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
