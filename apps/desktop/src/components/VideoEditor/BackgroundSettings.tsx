import { useCallback } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { BackgroundConfig, VideoBackgroundType } from '@/types';
import { videoEditorLogger } from '@/utils/logger';
import { BackgroundSettingsPanel } from '@/components/shared/background/BackgroundSettingsPanel';
import {
  useBackgroundSettingsController,
} from '@/components/shared/background/useBackgroundSettingsController';

interface BackgroundSettingsProps {
  background: BackgroundConfig;
  onUpdate: (updates: Partial<BackgroundConfig>) => void;
}

export function BackgroundSettings({ background, onUpdate }: BackgroundSettingsProps) {
  const handleWallpaperLoadError = useCallback((error: unknown) => {
    videoEditorLogger.error('Failed to load wallpapers:', error);
  }, []);

  const isWallpaperSelected = useCallback(
    (wallpaperId: string) => background.wallpaper?.includes(wallpaperId) ?? false,
    [background.wallpaper]
  );

  const { handleTypeChange, handleGradientPreset, handleToggleEnabled } =
    useBackgroundSettingsController<BackgroundConfig, VideoBackgroundType>({
      type: background.bgType,
      padding: background.padding,
      rounding: background.rounding,
      enabled: background.enabled,
      onPatch: onUpdate,
      keys: {
        type: 'bgType',
        padding: 'padding',
        rounding: 'rounding',
        enabled: 'enabled',
        gradientStart: 'gradientStart',
        gradientEnd: 'gradientEnd',
        gradientAngle: 'gradientAngle',
      },
    });

  const handleWallpaperSelect = useCallback(
    (wallpaperId: string) => {
      onUpdate({
        bgType: 'wallpaper',
        wallpaper: wallpaperId,
      });
    },
    [onUpdate]
  );

  const handleImageSelect = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        directory: false,
        filters: [
          {
            name: 'Images',
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'],
          },
        ],
      });

      if (!selected || Array.isArray(selected)) return;

      onUpdate({
        bgType: 'image',
        imagePath: selected,
      });
    } catch (err) {
      videoEditorLogger.error('Failed to select background image:', err);
    }
  }, [onUpdate]);

  const updateBorder = useCallback(
    (updates: Partial<BackgroundConfig['border']>) => {
      onUpdate({
        border: { ...background.border, ...updates },
      });
    },
    [background.border, onUpdate]
  );

  const updateShadow = useCallback(
    (updates: Partial<BackgroundConfig['shadow']>) => {
      onUpdate({
        shadow: { ...background.shadow, ...updates },
      });
    },
    [background.shadow, onUpdate]
  );

  return (
    <BackgroundSettingsPanel
      enabledToggle={{
        enabled: background.enabled,
        onToggle: () => {
          handleToggleEnabled?.();
        },
      }}
      type={background.bgType}
      onTypeChange={handleTypeChange}
      solidColor={background.solidColor}
      onSolidColorChange={(color) => onUpdate({ solidColor: color })}
      gradientStart={background.gradientStart}
      gradientEnd={background.gradientEnd}
      gradientAngle={background.gradientAngle}
      onGradientStartChange={(color) => onUpdate({ gradientStart: color })}
      onGradientEndChange={(color) => onUpdate({ gradientEnd: color })}
      onGradientAngleChange={(value) => onUpdate({ gradientAngle: value })}
      onGradientPresetSelect={handleGradientPreset}
      gradientPresetInactiveBorderClass="border-transparent"
      wallpaper={{
        id: background.wallpaper,
        onSelect: handleWallpaperSelect,
        isSelected: isWallpaperSelected,
        onLoadError: handleWallpaperLoadError,
      }}
      image={{
        src: background.imagePath
          ? background.imagePath.startsWith('data:')
            ? background.imagePath
            : convertFileSrc(background.imagePath)
          : null,
        onRemove: () => onUpdate({ imagePath: null }),
        uploader: {
          mode: 'button',
          emptyLabel: 'Select image',
          onPick: handleImageSelect,
        },
      }}
      padding={background.padding}
      onPaddingChange={(value) => onUpdate({ padding: value })}
      cornerRadius={background.rounding}
      cornerKind={background.roundingType}
      onCornerRadiusChange={(value) => onUpdate({ rounding: value })}
      onCornerKindChange={(kind) => onUpdate({ roundingType: kind })}
      border={{
        mode: 'toggle',
        enabled: background.border.enabled,
        width: background.border.width,
        color: background.border.color,
        opacity: background.border.opacity,
        onEnabledChange: (enabled) => updateBorder({ enabled }),
        onWidthChange: (width) => updateBorder({ width }),
        onColorChange: (color) => updateBorder({ color }),
        onOpacityChange: (opacity) => updateBorder({ opacity }),
      }}
      shadow={{
        mode: 'toggle',
        enabled: background.shadow.enabled,
        value: background.shadow.shadow,
        onEnabledChange: (enabled) => updateShadow({ enabled }),
        onValueChange: (shadow) => updateShadow({ shadow }),
      }}
    />
  );
}
