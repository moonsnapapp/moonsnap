/**
 * DimensionSelect - Compact dimension inputs matching source selector style.
 *
 * Shows editable W × H inputs plus a button that opens a native OS menu
 * for preset selection. Styled to match glass-source-group buttons.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Menu, MenuItem, PredefinedMenuItem } from '@tauri-apps/api/menu';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { BookmarkPlus, Check, ChevronDown, ChevronLeft, Link, Unlink } from 'lucide-react';
import { captureLogger } from '@/utils/logger';

// Common dimension presets
const DIMENSION_PRESETS = [
  { label: '1080p', width: 1920, height: 1080 },
  { label: '720p', width: 1280, height: 720 },
  { label: '480p', width: 854, height: 480 },
  { label: '4:3', width: 640, height: 480 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Story', width: 1080, height: 1920 },
] as const;

interface DimensionSelectProps {
  width: number;
  height: number;
  onDimensionChange?: (width: number, height: number) => void;
  onBack?: () => void;
  onSaveArea?: () => void;
  isAreaSaved?: boolean;
  isAreaSaveDisabled?: boolean;
  saveAreaTitle?: string;
  disabled?: boolean;
}

export const DimensionSelect: React.FC<DimensionSelectProps> = ({
  width,
  height,
  onDimensionChange,
  onBack,
  onSaveArea,
  isAreaSaved = false,
  isAreaSaveDisabled = false,
  saveAreaTitle,
  disabled = false,
}) => {
  // Local state for inputs
  const [widthInput, setWidthInput] = useState(String(Math.round(width)));
  const [heightInput, setHeightInput] = useState(String(Math.round(height)));
  const [linked, setLinked] = useState(true);
  const aspectRatio = useRef(width / height);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Update stored aspect ratio when props change
  useEffect(() => {
    if (width > 0 && height > 0) {
      aspectRatio.current = width / height;
    }
  }, [width, height]);

  // Sync when props change
  useEffect(() => {
    setWidthInput(String(Math.round(width)));
  }, [width]);

  useEffect(() => {
    setHeightInput(String(Math.round(height)));
  }, [height]);

  // Apply dimension change with optional constraint
  const applyWidth = useCallback(() => {
    const newWidth = parseInt(widthInput, 10);
    if (!isNaN(newWidth) && newWidth > 0) {
      const newHeight = linked ? Math.round(newWidth / aspectRatio.current) : Math.round(height);
      if (newHeight > 0) {
        onDimensionChange?.(newWidth, newHeight);
        return;
      }
    }
    setWidthInput(String(Math.round(width)));
  }, [widthInput, linked, width, height, onDimensionChange]);

  const applyHeight = useCallback(() => {
    const newHeight = parseInt(heightInput, 10);
    if (!isNaN(newHeight) && newHeight > 0) {
      const newWidth = linked ? Math.round(newHeight * aspectRatio.current) : Math.round(width);
      if (newWidth > 0) {
        onDimensionChange?.(newWidth, newHeight);
        return;
      }
    }
    setHeightInput(String(Math.round(height)));
  }, [heightInput, linked, width, height, onDimensionChange]);

  const handleWidthKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyWidth();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setWidthInput(String(Math.round(width)));
      (e.target as HTMLInputElement).blur();
    }
  }, [applyWidth, width]);

  const handleHeightKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      applyHeight();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setHeightInput(String(Math.round(height)));
      (e.target as HTMLInputElement).blur();
    }
  }, [applyHeight, height]);

  // Handle preset selection via native menu
  const handlePresetSelect = useCallback((preset: typeof DIMENSION_PRESETS[number]) => {
    onDimensionChange?.(preset.width, preset.height);
  }, [onDimensionChange]);

  // Open native menu
  const openPresetMenu = useCallback(async () => {
    if (disabled) return;

    try {
      const items = await Promise.all([
        MenuItem.new({
          id: 'header',
          text: 'Presets',
          enabled: false,
        }),
        PredefinedMenuItem.new({ item: 'Separator' }),
        ...DIMENSION_PRESETS.map((preset) =>
          MenuItem.new({
            id: `preset-${preset.label}`,
            text: `${preset.label}  (${preset.width}×${preset.height})`,
            action: () => handlePresetSelect(preset),
          })
        ),
      ]);

      const menu = await Menu.new({ items });

      const rect = buttonRef.current?.getBoundingClientRect();
      if (rect) {
        await menu.popup(new LogicalPosition(rect.left, rect.bottom + 4));
      } else {
        await menu.popup();
      }
    } catch (error) {
      captureLogger.error('Failed to open preset menu:', error);
    }
  }, [disabled, handlePresetSelect]);

  return (
    <div className={`glass-source-group ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Back button */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="glass-source-btn"
          title="Back to source selection"
        >
          <span className="glass-source-icon">
            <ChevronLeft size={18} strokeWidth={1.5} />
          </span>
          <span className="glass-source-label">Back</span>
        </button>
      )}

      {/* Dimension inputs styled as a source button */}
      <div className="glass-dimension-compact">
        <input
          type="text"
          value={widthInput}
          onChange={(e) => setWidthInput(e.target.value)}
          onBlur={applyWidth}
          onKeyDown={handleWidthKeyDown}
          className="glass-dimension-compact-input"
          title="Width"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => setLinked((v) => !v)}
          className={`glass-dimension-compact-link ${linked ? 'glass-dimension-compact-link--active' : ''}`}
          title={linked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
          disabled={disabled}
        >
          {linked ? <Link size={12} strokeWidth={1.8} /> : <Unlink size={12} strokeWidth={1.8} />}
        </button>
        <input
          type="text"
          value={heightInput}
          onChange={(e) => setHeightInput(e.target.value)}
          onBlur={applyHeight}
          onKeyDown={handleHeightKeyDown}
          className="glass-dimension-compact-input"
          title="Height"
          disabled={disabled}
        />
      </div>

      {/* Preset menu button styled as source button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={openPresetMenu}
        className="glass-source-btn"
        disabled={disabled}
        title="Dimension presets"
      >
        <span className="glass-source-icon">
          <ChevronDown size={18} strokeWidth={1.5} />
        </span>
        <span className="glass-source-label">Preset</span>
      </button>

      {onSaveArea && (
        <button
          type="button"
          onClick={onSaveArea}
          className={`glass-source-btn ${isAreaSaved ? 'glass-source-btn--active' : ''}`}
          disabled={disabled || isAreaSaved || isAreaSaveDisabled}
          title={saveAreaTitle ?? (isAreaSaved ? 'Area already saved' : 'Save this area')}
        >
          <span className="glass-source-icon">
            {isAreaSaved ? <Check size={18} strokeWidth={1.8} /> : <BookmarkPlus size={18} strokeWidth={1.5} />}
          </span>
          <span className="glass-source-label">{isAreaSaved ? 'Saved' : 'Save'}</span>
        </button>
      )}
    </div>
  );
};
