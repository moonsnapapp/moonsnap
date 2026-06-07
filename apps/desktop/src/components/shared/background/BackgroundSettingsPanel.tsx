import { ColorPicker } from '@/components/ui/color-picker';
import { COLOR_PRESETS } from '@/constants/wallpapers';
import {
  OpacityBorderEffectsSection,
  ToggleBorderEffectsSection,
  ToggleShadowEffectsSection,
  ValueShadowEffectsSection,
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

interface ToggleBorderEffectsConfig {
  kind: 'toggle';
  enabled: boolean;
  width: number;
  color: string;
  opacity: number;
  onEnabledChange: (enabled: boolean) => void;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

interface OpacityBorderEffectsConfig {
  kind: 'opacity';
  enabled: boolean;
  width: number;
  color: string;
  opacity: number;
  onWidthChange: (width: number) => void;
  onColorChange: (color: string) => void;
  onOpacityChange: (opacity: number) => void;
}

type BorderEffectsConfig = ToggleBorderEffectsConfig | OpacityBorderEffectsConfig;

interface ToggleShadowEffectsConfig {
  kind: 'toggle';
  enabled: boolean;
  value: number;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

interface ValueShadowEffectsConfig {
  kind: 'value';
  enabled: boolean;
  value: number;
  onValueChange: (value: number) => void;
  valueLabel?: string;
}

type ShadowEffectsConfig = ToggleShadowEffectsConfig | ValueShadowEffectsConfig;

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
  onCornerRadiusChange: (value: number) => void;
  border: BorderEffectsConfig;
  shadow: ShadowEffectsConfig;
}

function BorderEffects({ config }: { config: BorderEffectsConfig }) {
  if (config.kind === 'toggle') {
    const { kind: _kind, ...props } = config;
    return <ToggleBorderEffectsSection {...props} />;
  }

  const { kind: _kind, ...props } = config;
  return <OpacityBorderEffectsSection {...props} />;
}

function ShadowEffects({ config }: { config: ShadowEffectsConfig }) {
  if (config.kind === 'toggle') {
    const { kind: _kind, ...props } = config;
    return <ToggleShadowEffectsSection {...props} />;
  }

  const { kind: _kind, ...props } = config;
  return <ValueShadowEffectsSection {...props} />;
}

function EnabledToggleRow({ config }: { config?: EnabledToggleConfig }) {
  if (!config) return null;

  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="min-w-0 truncate text-xs text-[var(--ink-muted)]">
        {config.label ?? 'Show BG'}
      </span>
      <ToggleSwitch enabled={config.enabled} onToggle={config.onToggle} />
    </div>
  );
}

function WallpaperBackgroundSettings({ type, wallpaper }: {
  type: SharedBackgroundType;
  wallpaper: WallpaperConfig;
}) {
  if (type !== 'wallpaper') return null;

  return (
    <WallpaperSelector
      selectedWallpaperId={wallpaper.id}
      onSelect={wallpaper.onSelect}
      isSelected={wallpaper.isSelected}
      onLoadError={wallpaper.onLoadError}
    />
  );
}

function ImageBackgroundSettings({ type, image }: {
  type: SharedBackgroundType;
  image: ImageConfig;
}) {
  if (type !== 'image') return null;

  return (
    <ImageBackgroundSection
      imageSrc={image.src}
      onRemove={image.onRemove}
      uploader={image.uploader}
    />
  );
}

function SolidBackgroundSettings({
  type,
  solidColor,
  onSolidColorChange,
}: {
  type: SharedBackgroundType;
  solidColor: string;
  onSolidColorChange: (color: string) => void;
}) {
  if (type !== 'solid') return null;

  return (
    <div className="space-y-3">
      <ColorPicker
        value={solidColor}
        onChange={onSolidColorChange}
        presets={COLOR_PRESETS}
      />
    </div>
  );
}

function GradientBackgroundSettings({
  type,
  gradientStart,
  gradientEnd,
  gradientAngle,
  onGradientStartChange,
  onGradientEndChange,
  onGradientAngleChange,
  onGradientPresetSelect,
  gradientPresetInactiveBorderClass,
}: Pick<
  BackgroundSettingsPanelProps<SharedBackgroundType>,
  | 'type'
  | 'gradientStart'
  | 'gradientEnd'
  | 'gradientAngle'
  | 'onGradientStartChange'
  | 'onGradientEndChange'
  | 'onGradientAngleChange'
  | 'onGradientPresetSelect'
  | 'gradientPresetInactiveBorderClass'
>) {
  if (type !== 'gradient') return null;

  return (
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
  );
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
  onCornerRadiusChange,
  border,
  shadow,
}: BackgroundSettingsPanelProps<TType>) {
  return (
    <div className="min-w-0 space-y-4">
      <EnabledToggleRow config={enabledToggle} />

      <BackgroundTypeTabs
        currentType={type}
        onTypeChange={(next) => onTypeChange(next as TType)}
      />

      <div className="border-t border-dashed border-[var(--glass-border)]" />

      <WallpaperBackgroundSettings type={type} wallpaper={wallpaper} />
      <ImageBackgroundSettings type={type} image={image} />
      <SolidBackgroundSettings
        type={type}
        solidColor={solidColor}
        onSolidColorChange={onSolidColorChange}
      />
      <GradientBackgroundSettings
        type={type}
        gradientStart={gradientStart}
        gradientEnd={gradientEnd}
        gradientAngle={gradientAngle}
        onGradientStartChange={onGradientStartChange}
        onGradientEndChange={onGradientEndChange}
        onGradientAngleChange={onGradientAngleChange}
        onGradientPresetSelect={onGradientPresetSelect}
        gradientPresetInactiveBorderClass={gradientPresetInactiveBorderClass}
      />

      <PaddingSection value={padding} onChange={onPaddingChange} />

      <CornerRadiusSection
        value={cornerRadius}
        onValueChange={onCornerRadiusChange}
      />

      <BorderEffects config={border} />
      <ShadowEffects config={shadow} />
    </div>
  );
}
