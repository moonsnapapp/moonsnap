import { ColorPicker } from '@/components/ui/color-picker';
import { COLOR_PRESETS } from '@/constants/wallpapers';
import {
  BorderEffectsSection,
  type BorderEffectsSectionProps,
  ShadowEffectsSection,
  type ShadowEffectsSectionProps,
  ToggleSwitch,
} from '@/components/shared/FrameEffectsControls';
import {
  BackgroundTypeTabs,
  type SharedBackgroundType,
} from '@/components/shared/background/BackgroundTypeTabs';
import { WallpaperSelector } from '@/components/shared/background/WallpaperSelector';
import {
  GradientSection,
  type GradientPreset,
  PaddingSection,
  CornerRadiusSection,
  type CornerKind,
} from '@/components/shared/background/BackgroundStyleSections';
import {
  ImageBackgroundSection,
  type ImageUploader,
} from '@/components/shared/background/ImageBackgroundSection';

interface EnabledToggleConfig {
  enabled: boolean;
  onToggle: () => void;
  label?: string;
}

interface WallpaperConfig {
  id?: string | null;
  onSelect: (wallpaperId: string) => void | Promise<void>;
  isSelected?: (wallpaperId: string) => boolean;
  onLoadError?: (error: unknown) => void;
}

interface ImageConfig {
  src: string | null;
  onRemove: () => void;
  uploader: ImageUploader;
}

interface BackgroundSettingsPanelProps<TType extends SharedBackgroundType> {
  enabledToggle?: EnabledToggleConfig;
  type: TType;
  onTypeChange: (type: TType) => void;
  solidColor: string;
  onSolidColorChange: (color: string) => void;
  gradientStart: string;
  gradientEnd: string;
  gradientAngle: number;
  onGradientStartChange: (color: string) => void;
  onGradientEndChange: (color: string) => void;
  onGradientAngleChange: (value: number) => void;
  onGradientPresetSelect: (preset: GradientPreset) => void;
  gradientPresetInactiveBorderClass?: string;
  wallpaper: WallpaperConfig;
  image: ImageConfig;
  padding: number;
  onPaddingChange: (value: number) => void;
  cornerRadius: number;
  cornerKind: CornerKind;
  onCornerRadiusChange: (value: number) => void;
  onCornerKindChange: (kind: CornerKind) => void;
  border: BorderEffectsSectionProps;
  shadow: ShadowEffectsSectionProps;
}

export function BackgroundSettingsPanel<TType extends SharedBackgroundType>({
  enabledToggle,
  type,
  onTypeChange,
  solidColor,
  onSolidColorChange,
  gradientStart,
  gradientEnd,
  gradientAngle,
  onGradientStartChange,
  onGradientEndChange,
  onGradientAngleChange,
  onGradientPresetSelect,
  gradientPresetInactiveBorderClass,
  wallpaper,
  image,
  padding,
  onPaddingChange,
  cornerRadius,
  cornerKind,
  onCornerRadiusChange,
  onCornerKindChange,
  border,
  shadow,
}: BackgroundSettingsPanelProps<TType>) {
  const showBody = enabledToggle ? enabledToggle.enabled : true;

  return (
    <div className="space-y-4">
      {enabledToggle && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--ink-muted)]">
            {enabledToggle.label ?? 'Show BG'}
          </span>
          <ToggleSwitch enabled={enabledToggle.enabled} onToggle={enabledToggle.onToggle} />
        </div>
      )}

      {showBody && (
        <>
          <BackgroundTypeTabs
            currentType={type}
            onTypeChange={(next) => onTypeChange(next as TType)}
          />

          <div className="border-t border-dashed border-[var(--glass-border)]" />

          {type === 'wallpaper' && (
            <WallpaperSelector
              selectedWallpaperId={wallpaper.id}
              onSelect={wallpaper.onSelect}
              isSelected={wallpaper.isSelected}
              onLoadError={wallpaper.onLoadError}
            />
          )}

          {type === 'image' && (
            <ImageBackgroundSection
              imageSrc={image.src}
              onRemove={image.onRemove}
              uploader={image.uploader}
            />
          )}

          {type === 'solid' && (
            <div className="space-y-3">
              <ColorPicker
                value={solidColor}
                onChange={onSolidColorChange}
                presets={COLOR_PRESETS}
              />
            </div>
          )}

          {type === 'gradient' && (
            <GradientSection
              gradientStart={gradientStart}
              gradientEnd={gradientEnd}
              gradientAngle={gradientAngle}
              onGradientStartChange={onGradientStartChange}
              onGradientEndChange={onGradientEndChange}
              onGradientAngleChange={onGradientAngleChange}
              onPresetSelect={onGradientPresetSelect}
              inactivePresetBorderClass={gradientPresetInactiveBorderClass}
            />
          )}

          <PaddingSection value={padding} onChange={onPaddingChange} />

          <CornerRadiusSection
            value={cornerRadius}
            kind={cornerKind}
            onValueChange={onCornerRadiusChange}
            onKindChange={onCornerKindChange}
          />

          <BorderEffectsSection {...border} />
          <ShadowEffectsSection {...shadow} />
        </>
      )}
    </div>
  );
}
