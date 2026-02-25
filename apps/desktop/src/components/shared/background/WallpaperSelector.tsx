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

const WALLPAPER_THEME_KEYS = Object.keys(WALLPAPER_THEMES) as WallpaperTheme[];
const wallpaperCache = new Map<WallpaperTheme, LoadedWallpaper[]>();
const wallpaperLoadPromises = new Map<WallpaperTheme, Promise<LoadedWallpaper[]>>();

function isWallpaperTheme(value: string): value is WallpaperTheme {
  return WALLPAPER_THEME_KEYS.includes(value as WallpaperTheme);
}

function getThemeFromWallpaperId(wallpaperId?: string | null): WallpaperTheme | null {
  if (!wallpaperId) return null;
  const [theme] = wallpaperId.split('/');
  return theme && isWallpaperTheme(theme) ? theme : null;
}

async function loadWallpapersForTheme(theme: WallpaperTheme): Promise<LoadedWallpaper[]> {
  const cached = wallpaperCache.get(theme);
  if (cached) {
    return cached;
  }

  const inFlight = wallpaperLoadPromises.get(theme);
  if (inFlight) {
    return inFlight;
  }

  const loadPromise = (async () => {
    const wallpaperIds = WALLPAPERS_BY_THEME[theme];
    const loaded: LoadedWallpaper[] = [];

    for (const id of wallpaperIds) {
      try {
        const [wallpaperTheme, wallpaperName] = id.split('/');
        let resolvedPath: string;

        try {
          resolvedPath = await resolveResource(`assets/backgrounds/${wallpaperTheme}/thumbs/${wallpaperName}.jpg`);
        } catch {
          resolvedPath = await resolveResource(`assets/backgrounds/${id}.jpg`);
        }

        loaded.push({ id, url: convertFileSrc(resolvedPath) });
      } catch {
        // Skip wallpapers that fail to resolve.
      }
    }

    wallpaperCache.set(theme, loaded);
    return loaded;
  })();

  wallpaperLoadPromises.set(theme, loadPromise);

  try {
    return await loadPromise;
  } finally {
    wallpaperLoadPromises.delete(theme);
  }
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
  const initialSelectedTheme = getThemeFromWallpaperId(selectedWallpaperId) ?? initialTheme;
  const [wallpaperTheme, setWallpaperTheme] = useState<WallpaperTheme>(initialSelectedTheme);
  const [loadedWallpapers, setLoadedWallpapers] = useState<LoadedWallpaper[]>(
    () => wallpaperCache.get(initialSelectedTheme) ?? []
  );
  const [isLoadingWallpapers, setIsLoadingWallpapers] = useState<boolean>(
    () => !wallpaperCache.has(initialSelectedTheme)
  );
  const onLoadErrorRef = useRef(onLoadError);

  useEffect(() => {
    onLoadErrorRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const selectedTheme = getThemeFromWallpaperId(selectedWallpaperId);
    if (!selectedTheme) return;
    setWallpaperTheme((currentTheme) =>
      currentTheme === selectedTheme ? currentTheme : selectedTheme
    );
  }, [selectedWallpaperId]);

  useEffect(() => {
    let isCancelled = false;
    const cached = wallpaperCache.get(wallpaperTheme);

    if (cached) {
      setLoadedWallpapers(cached);
      setIsLoadingWallpapers(false);
      return () => {
        isCancelled = true;
      };
    }

    setIsLoadingWallpapers(true);

    void loadWallpapersForTheme(wallpaperTheme)
      .then((loaded) => {
        if (!isCancelled) {
          setLoadedWallpapers(loaded);
        }
      })
      .catch((error) => {
        if (!isCancelled) {
          onLoadErrorRef.current?.(error);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingWallpapers(false);
        }
      });

    return () => {
      isCancelled = true;
    };
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
        {WALLPAPER_THEME_KEYS.map((theme) => (
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
