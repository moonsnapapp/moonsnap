import { useEffect, useState, useCallback } from 'react';
import { nanoid } from 'nanoid';
import type { CanvasShape, Tool } from '../types';

/** Check if keyboard event target is a text input (should ignore shortcuts) */
export function isTextInputTarget(e: KeyboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

/** Check if a ClipboardEvent target is a text input */
function isTextInputClipboardTarget(e: ClipboardEvent): boolean {
  return e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
}

interface UseKeyboardShortcutsProps {
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  shapes: CanvasShape[];
  onShapesChange: (shapes: CanvasShape[]) => void;
  /** Record action for undo/redo (take snapshot + action + commit) */
  recordAction: (action: () => void) => void;
  /** Get canvas position from screen position */
  getCanvasPosition: (screenPos: { x: number; y: number }) => { x: number; y: number };
  /** Container size for centering pasted images */
  containerSize: { width: number; height: number };
  /** Switch to a different tool */
  setSelectedTool: (tool: Tool) => void;
}

interface UseKeyboardShortcutsReturn {
  isShiftHeld: boolean;
}

/**
 * Hook for keyboard shortcuts in the editor canvas
 * - Delete/Backspace: Delete selected shapes
 * - Ctrl+A: Select all shapes
 * - Ctrl+D: Duplicate selected shapes
 * - Ctrl+V: Paste image from clipboard
 * - Shift: Track for proportional resize constraint
 */
export const useKeyboardShortcuts = ({
  selectedIds,
  setSelectedIds,
  shapes,
  onShapesChange,
  recordAction,
  getCanvasPosition,
  containerSize,
  setSelectedTool,
}: UseKeyboardShortcutsProps): UseKeyboardShortcutsReturn => {
  const [isShiftHeld, setIsShiftHeld] = useState(false);

  // Delete selected shapes handler (protects background shape)
  const handleDelete = useCallback(() => {
    if (selectedIds.length === 0) return;

    // Filter out background shapes — they cannot be deleted
    const deletableIds = selectedIds.filter((id) => {
      const shape = shapes.find((s) => s.id === id);
      return shape && !shape.isBackground;
    });
    if (deletableIds.length === 0) return;

    recordAction(() => {
      const newShapes = shapes.filter((shape) => !deletableIds.includes(shape.id));
      onShapesChange(newShapes);
    });
    setSelectedIds([]);
  }, [selectedIds, shapes, onShapesChange, setSelectedIds, recordAction]);

  // Select all shapes handler (includes background for consistency — user can move it too)
  const handleSelectAll = useCallback(() => {
    if (shapes.length === 0) return;
    setSelectedIds(shapes.map(s => s.id));
  }, [shapes, setSelectedIds]);

  // Duplicate selected shapes handler (skips background shapes)
  const handleDuplicate = useCallback(() => {
    if (selectedIds.length === 0) return;

    recordAction(() => {
      const duplicatedShapes: CanvasShape[] = [];
      const newSelectedIds: string[] = [];
      const OFFSET = 20; // Offset duplicates by 20px for visibility

      selectedIds.forEach(id => {
        const original = shapes.find(s => s.id === id);
        if (original && !original.isBackground) {
          const newId = nanoid();
          const duplicate: CanvasShape = {
            ...original,
            id: newId,
            // Offset position for visibility
            x: (original.x ?? 0) + OFFSET,
            y: (original.y ?? 0) + OFFSET,
            // For pen tool, offset all points
            points: original.points?.map((val) =>
              val + OFFSET // All points need offset (x and y alternate)
            ),
          };
          duplicatedShapes.push(duplicate);
          newSelectedIds.push(newId);
        }
      });

      onShapesChange([...shapes, ...duplicatedShapes]);
      setSelectedIds(newSelectedIds);
    });
  }, [selectedIds, shapes, onShapesChange, setSelectedIds]);

  // Paste image from clipboard handler
  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (isTextInputClipboardTarget(e)) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    // Find an image item in the clipboard
    let imageItem: DataTransferItem | null = null;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        imageItem = items[i];
        break;
      }
    }
    if (!imageItem) return;

    e.preventDefault();

    const blob = imageItem.getAsFile();
    if (!blob) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;

      // Load image to get natural dimensions
      const img = new window.Image();
      img.onload = () => {
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;

        // Calculate center of the current viewport in canvas coordinates
        const centerScreen = {
          x: containerSize.width / 2,
          y: containerSize.height / 2,
        };
        const centerCanvas = getCanvasPosition(centerScreen);

        const newId = nanoid();
        const imageShape: CanvasShape = {
          id: newId,
          type: 'image',
          x: centerCanvas.x - imgWidth / 2,
          y: centerCanvas.y - imgHeight / 2,
          width: imgWidth,
          height: imgHeight,
          imageSrc: dataUrl,
        };

        recordAction(() => {
          onShapesChange([...shapes, imageShape]);
        });

        setSelectedIds([newId]);
        setSelectedTool('select');
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(blob);
  }, [shapes, onShapesChange, recordAction, setSelectedIds, setSelectedTool, getCanvasPosition, containerSize]);

  // Combined keyboard event handler for shortcuts and shift tracking
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Track Shift key for proportional resize constraint
      if (e.key === 'Shift') {
        setIsShiftHeld(true);
        return;
      }

      // Don't handle shortcuts if user is typing in an input
      if (isTextInputTarget(e)) return;

      // Delete selected shapes
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.length > 0) {
        e.preventDefault();
        handleDelete();
        return;
      }

      // Ctrl+A: Select all shapes
      if ((e.ctrlKey || e.metaKey) && e.key === 'a' && shapes.length > 0) {
        e.preventDefault();
        handleSelectAll();
        return;
      }

      // Ctrl+D: Duplicate selected shapes
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && selectedIds.length > 0) {
        e.preventDefault();
        handleDuplicate();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setIsShiftHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('paste', handlePaste);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('paste', handlePaste);
    };
  }, [selectedIds, shapes, handleDelete, handleSelectAll, handleDuplicate, handlePaste]);

  return { isShiftHeld };
};
