import { useEffect, useMemo, useRef, useState } from 'react';
import { resolveResource } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Check, Loader2 } from 'lucide-react';
import {
  WALLPAPER_THEMES,
  WALLPAPERS_BY_THEME,
  type WallpaperTheme,
} from '@/constants/wallpapers';

interface LoadedWallpaper {
  id: string;
  url: string;
}

interface WallpaperSelectorProps {
  selectedWallpaperId?: string | null;
  onSelect: (wallpaperId: string) => void | Promise<void>;
  isSelected?: (wallpaperId: string) => boolean;
  onLoadError?: (error: unknown) => void;
  initialTheme?: WallpaperTheme;
}

export function WallpaperSelector({
  selectedWallpaperId = null,
  onSelect,
  isSelected,
  onLoadError,
  initialTheme = 'macOS',
}: WallpaperSelectorProps) {
  const [wallpaperTheme, setWallpaperTheme] = useState<WallpaperTheme>(initialTheme);
  const [loadedWallpapers, setLoadedWallpapers] = useState<LoadedWallpaper[]>([]);
  const [isLoadingWallpapers, setIsLoadingWallpapers] = useState(false);
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    async function loadWallpapers() {
      setIsLoadingWallpapers(true);
      try {
        const wallpaperIds = WALLPAPERS_BY_THEME[wallpaperTheme];
        const loaded: LoadedWallpaper[] = [];

        for (const id of wallpaperIds) {
          try {
            const parts = id.split('/');
            const theme = parts[0];
            const name = parts[1];
            let url: string;
            let resolvedPath: string;
            try {
              resolvedPath = await resolveResource(`assets/backgrounds/${theme}/thumbs/${name}.jpg`);
              url = convertFileSrc(resolvedPath);
            } catch {
              resolvedPath = await resolveResource(`assets/backgrounds/${id}.jpg`);
              url = convertFileSrc(resolvedPath);
            }
            loaded.push({ id, url });
          } catch {
            // Silently skip wallpapers that fail to load
          }
        }

        setLoadedWallpapers(loaded);
      } catch (error) {
        onLoadErrorRef.current?.(error);
      } finally {
        setIsLoadingWallpapers(false);
      }
    }

    void loadWallpapers();
  }, [wallpaperTheme]);

  const isWallpaperSelected = useMemo(() => {
    if (isSelected) {
      return isSelected;
    }
    return (wallpaperId: string) => selectedWallpaperId === wallpaperId;
  }, [isSelected, selectedWallpaperId]);

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {(Object.keys(WALLPAPER_THEMES) as WallpaperTheme[]).map((theme) => (
          <button
            key={theme}
            onClick={() => setWallpaperTheme(theme)}
            className={`flex-shrink-0 px-3 py-1.5 text-xs rounded-md transition-colors ${
              wallpaperTheme === theme
                ? 'bg-[var(--coral-100)] text-[var(--coral-500)] border border-[var(--coral-300)]'
                : 'bg-[var(--polar-mist)] text-[var(--ink-muted)] border border-[var(--glass-border)] hover:bg-[var(--polar-frost)]'
            }`}
          >
            {WALLPAPER_THEMES[theme]}
          </button>
        ))}
      </div>

      {isLoadingWallpapers ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-[var(--ink-muted)]" />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {loadedWallpapers.map((wallpaper) => {
            const selected = isWallpaperSelected(wallpaper.id);
            return (
              <button
                key={wallpaper.id}
                onClick={() => {
                  void onSelect(wallpaper.id);
                }}
                className={`aspect-video rounded-lg overflow-hidden border-2 transition-all hover:scale-[1.02] relative ${
                  selected
                    ? 'border-[var(--coral-400)] ring-2 ring-[var(--coral-200)]'
                    : 'border-transparent hover:border-[var(--glass-border)]'
                }`}
              >
                <img
                  src={wallpaper.url}
                  alt={wallpaper.id}
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover"
                  style={{ contentVisibility: 'auto' }}
                />
                {selected && (
                  <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-[var(--coral-400)] flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
