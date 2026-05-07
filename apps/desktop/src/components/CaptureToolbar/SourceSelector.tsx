/**
 * SourceSelector - Capture source selection (Display/Window/Region)
 * 
 * - Display: Opens picker panel, D2D highlights hovered monitor, click captures
 * - Window: Opens picker panel with search, D2D highlights hovered window, click captures
 * - Area: Opens D2D overlay for drag-to-select region
 */

import React from 'react';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from '@tauri-apps/api/menu';
import { ChevronDown, SquareDashedMousePointer } from 'lucide-react';
import { DisplayPickerPanel } from './DisplayPickerPanel';
import { WindowPickerPanel } from './WindowPickerPanel';
import type { CaptureType } from '@/types';
import type {
  AreaSelectionBounds,
  SavedAreaSelection,
} from '@/stores/captureSettingsStore';
import { captureLogger } from '@/utils/logger';

export type CaptureSource = 'display' | 'window' | 'area';

interface SourceSelectorProps {
  onSelectArea?: () => void;
  onSelectLastArea?: () => void;
  onSelectSavedArea?: (selection: SavedAreaSelection) => void;
  onDeleteSavedArea?: (id: string) => void;
  /** Capture type for the picker panels */
  captureType?: CaptureType;
  /** Called when a capture is completed from the picker panels */
  onCaptureComplete?: () => void;
  toolbarOwner?: string;
  lastAreaSelection?: AreaSelectionBounds | null;
  savedAreaSelections?: SavedAreaSelection[];
  disabled?: boolean;
}

function formatAreaSelectionLabel(selection: AreaSelectionBounds): string {
  return `${selection.width}x${selection.height} at ${selection.x}, ${selection.y}`;
}

export const SourceSelector: React.FC<SourceSelectorProps> = ({
  onSelectArea,
  onSelectLastArea,
  onSelectSavedArea,
  onDeleteSavedArea,
  captureType = 'screenshot',
  onCaptureComplete,
  toolbarOwner,
  lastAreaSelection,
  savedAreaSelections = [],
  disabled = false,
}) => {
  const areaMenuButtonRef = React.useRef<HTMLButtonElement>(null);

  const openAreaMenu = React.useCallback(async () => {
    if (disabled) {
      return;
    }

    try {
      const items = [
        await MenuItem.new({
          id: 'header',
          text: 'Area Options',
          enabled: false,
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          id: 'use-last-area',
          text: lastAreaSelection
            ? `Use Last Area (${formatAreaSelectionLabel(lastAreaSelection)})`
            : 'Use Last Area',
          enabled: Boolean(lastAreaSelection),
          action: () => {
            if (lastAreaSelection) {
              onSelectLastArea?.();
            }
          },
        }),
      ];

      if (savedAreaSelections.length > 0) {
        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));

        for (const savedArea of savedAreaSelections) {
          items.push(
            await MenuItem.new({
              id: `saved-area-${savedArea.id}`,
              text: `${savedArea.name} (${formatAreaSelectionLabel(savedArea)})`,
              action: () => onSelectSavedArea?.(savedArea),
            })
          );
        }

        const deleteItems = await Promise.all(
          savedAreaSelections.map((savedArea) =>
            MenuItem.new({
              id: `delete-saved-area-${savedArea.id}`,
              text: savedArea.name,
              action: () => onDeleteSavedArea?.(savedArea.id),
            })
          )
        );

        items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
        items.push(
          await Submenu.new({
            id: 'delete-saved-area-submenu',
            text: 'Delete Saved Area',
            items: deleteItems,
          })
        );
      }

      const menu = await Menu.new({ items });
      const rect = areaMenuButtonRef.current?.getBoundingClientRect();
      if (rect) {
        await menu.popup(new LogicalPosition(rect.left, rect.bottom + 4));
      } else {
        await menu.popup();
      }
    } catch (error) {
      captureLogger.error('Failed to open area menu:', error);
    }
  }, [disabled, lastAreaSelection, onDeleteSavedArea, onSelectLastArea, onSelectSavedArea, savedAreaSelections]);

  return (
    <div className={`glass-source-group ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Display Picker - handles its own capture */}
      <DisplayPickerPanel
        disabled={disabled}
        captureType={captureType}
        onCaptureComplete={onCaptureComplete}
        toolbarOwner={toolbarOwner}
      />

      {/* Window Picker - handles its own capture */}
      <WindowPickerPanel
        disabled={disabled}
        captureType={captureType}
        onCaptureComplete={onCaptureComplete}
        toolbarOwner={toolbarOwner}
      />

      {/* Area/Region Selection */}
      <div className="glass-source-split">
        <button
          onClick={onSelectArea}
          className="glass-source-btn glass-source-btn--split-main"
          title="Draw a new area"
          disabled={disabled}
        >
          <span className="glass-source-icon">
            <SquareDashedMousePointer size={18} strokeWidth={1.5} />
          </span>
          <span className="glass-source-label">Area</span>
        </button>

        <button
          ref={areaMenuButtonRef}
          type="button"
          onClick={openAreaMenu}
          className="glass-source-btn glass-source-btn--split-menu"
          title="Area options"
          disabled={disabled}
        >
          <span className="glass-source-icon">
            <ChevronDown size={16} strokeWidth={1.7} />
          </span>
        </button>
      </div>
    </div>
  );
};
