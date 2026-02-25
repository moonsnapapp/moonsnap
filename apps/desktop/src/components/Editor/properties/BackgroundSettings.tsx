import React, { useState, useEffect, useCallback } from 'react';
import { resolveResource } from '@tauri-apps/api/path';
import { convertFileSrc } from '@tauri-apps/api/core';
import { BackgroundSettingsPanel } from '@/components/shared/background/BackgroundSettingsPanel';
import {
  useBackgroundSettingsController,
} from '@/components/shared/background/useBackgroundSettingsController';
import type { CompositorSettings, BackgroundType } from '../../../types';

interface BackgroundSettingsProps {
  settings: CompositorSettings;
  onSettingsChange: (settings: Partial<CompositorSettings>) => void;
}

export const BackgroundSettings: React.FC<BackgroundSettingsProps> = ({
  settings,
  onSettingsChange,
}) => {
  const [localPadding, setLocalPadding] = useState(settings.padding);
  const [localBorderRadius, setLocalBorderRadius] = useState(settings.borderRadius);
  const [localShadowIntensity, setLocalShadowIntensity] = useState(settings.shadowIntensity);
  const [localGradientAngle, setLocalGradientAngle] = useState(settings.gradientAngle);
  const [localBorderWidth, setLocalBorderWidth] = useState(settings.borderWidth ?? 2);
  const [localBorderOpacity, setLocalBorderOpacity] = useState(settings.borderOpacity ?? 0);

  useEffect(() => {
    setLocalPadding(settings.padding);
    setLocalBorderRadius(settings.borderRadius);
    setLocalShadowIntensity(settings.shadowIntensity);
    setLocalGradientAngle(settings.gradientAngle);
    setLocalBorderWidth(settings.borderWidth ?? 2);
    setLocalBorderOpacity(settings.borderOpacity ?? 0);
  }, [
    settings.padding,
    settings.borderRadius,
    settings.shadowIntensity,
    settings.gradientAngle,
    settings.borderWidth,
    settings.borderOpacity,
  ]);

  const { handleTypeChange, handleGradientPreset } =
    useBackgroundSettingsController<CompositorSettings, BackgroundType>({
      type: settings.backgroundType,
      padding: settings.padding,
      rounding: settings.borderRadius,
      enabled: settings.enabled,
      onPatch: onSettingsChange,
      keys: {
        type: 'backgroundType',
        padding: 'padding',
        rounding: 'borderRadius',
        enabled: 'enabled',
        gradientStart: 'gradientStart',
        gradientEnd: 'gradientEnd',
        gradientAngle: 'gradientAngle',
      },
    });

  const handleWallpaperSelect = useCallback(
    async (wallpaperId: string) => {
      try {
        const parts = wallpaperId.split('/');
        const theme = parts[0];
        const name = parts[1];
        const resolvedPath = await resolveResource(`assets/backgrounds/${theme}/${name}.jpg`);
        const url = convertFileSrc(resolvedPath);

        onSettingsChange({
          backgroundType: 'wallpaper',
          wallpaper: wallpaperId,
          backgroundImage: url,
        });
      } catch {
        onSettingsChange({
          backgroundType: 'wallpaper',
          wallpaper: wallpaperId,
        });
      }
    },
    [onSettingsChange]
  );

  const handleImageUpload = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        onSettingsChange({
          backgroundType: 'image',
          backgroundImage: ev.target?.result as string,
        });
      };
      reader.readAsDataURL(file);
    },
    [onSettingsChange]
  );

  return (
    <BackgroundSettingsPanel
      type={settings.backgroundType}
      onTypeChange={handleTypeChange}
      solidColor={settings.backgroundColor}
      onSolidColorChange={(color) => onSettingsChange({ backgroundColor: color })}
      gradientStart={settings.gradientStart}
      gradientEnd={settings.gradientEnd}
      gradientAngle={localGradientAngle}
      onGradientStartChange={(color) => onSettingsChange({ gradientStart: color })}
      onGradientEndChange={(color) => onSettingsChange({ gradientEnd: color })}
      onGradientAngleChange={(value) => {
        setLocalGradientAngle(value);
        onSettingsChange({ gradientAngle: value });
      }}
      onGradientPresetSelect={handleGradientPreset}
      gradientPresetInactiveBorderClass="border-[var(--glass-border)]"
      wallpaper={{
        id: settings.wallpaper,
        onSelect: handleWallpaperSelect,
      }}
      image={{
        src: settings.backgroundImage,
        onRemove: () => onSettingsChange({ backgroundImage: null }),
        uploader: {
          mode: 'file-input',
          emptyLabel: 'Click to upload',
          onFileSelect: handleImageUpload,
        },
      }}
      padding={localPadding}
      onPaddingChange={(value) => {
        setLocalPadding(value);
        onSettingsChange({ padding: value });
      }}
      cornerRadius={localBorderRadius}
      cornerKind={settings.borderRadiusType}
      onCornerRadiusChange={(value) => {
        setLocalBorderRadius(value);
        onSettingsChange({ borderRadius: value });
      }}
      onCornerKindChange={(kind) => onSettingsChange({ borderRadiusType: kind })}
      border={{
        mode: 'opacity',
        enabled: localBorderOpacity > 0,
        width: localBorderWidth,
        color: settings.borderColor ?? '#ffffff',
        opacity: localBorderOpacity,
        onOpacityChange: (value) => {
          setLocalBorderOpacity(value);
          onSettingsChange({ borderOpacity: value });
        },
        onWidthChange: (value) => {
          setLocalBorderWidth(value);
          onSettingsChange({ borderWidth: value });
        },
        onColorChange: (color) => onSettingsChange({ borderColor: color }),
      }}
      shadow={{
        mode: 'value',
        enabled: localShadowIntensity > 0,
        value: localShadowIntensity * 100,
        onValueChange: (value) => {
          setLocalShadowIntensity(value / 100);
          onSettingsChange({ shadowIntensity: value / 100 });
        },
      }}
    />
  );
};

export default BackgroundSettings;
