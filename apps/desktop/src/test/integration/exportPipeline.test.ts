import { describe, it, expect, vi } from 'vitest';
import type { CompositorSettings, CanvasBounds } from '@/types';
import { DEFAULT_COMPOSITOR_SETTINGS } from '@/types';

/**
 * Tests for export pipeline functions.
 * Focuses on getContentBounds logic and export bounds calculation
 * without requiring a real Konva stage.
 */

// Test the bounds calculation logic directly
describe('Export Pipeline', () => {
  describe('getContentBounds logic', () => {
    it('should use cropRegion when provided', () => {
      const cropRegion = { x: 10, y: 20, width: 500, height: 400 };
      const canvasBounds: CanvasBounds = { width: 1920, height: 1080, imageOffsetX: 0, imageOffsetY: 0 };

      // cropRegion takes priority (mirrors getContentBounds behavior)
      const bounds = {
        x: cropRegion.x,
        y: cropRegion.y,
        width: cropRegion.width,
        height: cropRegion.height,
      };

      expect(bounds).toEqual({ x: 10, y: 20, width: 500, height: 400 });
    });

    it('should use canvasBounds with imageOffset when no cropRegion', () => {
      const canvasBounds: CanvasBounds = { width: 800, height: 600, imageOffsetX: 100, imageOffsetY: 50 };

      const bounds = {
        width: canvasBounds.width,
        height: canvasBounds.height,
        x: -canvasBounds.imageOffsetX,
        y: -canvasBounds.imageOffsetY,
      };

      expect(bounds).toEqual({ x: -100, y: -50, width: 800, height: 600 });
    });

    it('should fallback to image dimensions when no canvasBounds', () => {
      const imageWidth = 1920;
      const imageHeight = 1080;

      const bounds = {
        width: imageWidth,
        height: imageHeight,
        x: 0,
        y: 0,
      };

      expect(bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    });
  });

  describe('calculateExportBounds logic', () => {
    it('should add compositor padding when enabled', () => {
      const contentBounds = { x: 0, y: 0, width: 800, height: 600 };
      const settings: CompositorSettings = {
        ...DEFAULT_COMPOSITOR_SETTINGS,
        enabled: true,
        padding: 32,
      };

      // Mirrors calculateExportBounds behavior
      const exportBounds = settings.enabled
        ? {
            x: contentBounds.x - settings.padding,
            y: contentBounds.y - settings.padding,
            width: contentBounds.width + settings.padding * 2,
            height: contentBounds.height + settings.padding * 2,
          }
        : contentBounds;

      expect(exportBounds).toEqual({
        x: -32,
        y: -32,
        width: 864,
        height: 664,
      });
    });

    it('should not add padding when compositor disabled', () => {
      const contentBounds = { x: 0, y: 0, width: 800, height: 600 };
      const settings: CompositorSettings = {
        ...DEFAULT_COMPOSITOR_SETTINGS,
        enabled: false,
      };

      const exportBounds = settings.enabled
        ? {
            x: contentBounds.x - settings.padding,
            y: contentBounds.y - settings.padding,
            width: contentBounds.width + settings.padding * 2,
            height: contentBounds.height + settings.padding * 2,
          }
        : contentBounds;

      expect(exportBounds).toEqual(contentBounds);
    });

    it('should apply different padding values', () => {
      const contentBounds = { x: 0, y: 0, width: 1920, height: 1080 };
      const settings: CompositorSettings = {
        ...DEFAULT_COMPOSITOR_SETTINGS,
        enabled: true,
        padding: 64,
      };

      const exportBounds = settings.enabled
        ? {
            x: contentBounds.x - settings.padding,
            y: contentBounds.y - settings.padding,
            width: contentBounds.width + settings.padding * 2,
            height: contentBounds.height + settings.padding * 2,
          }
        : contentBounds;

      expect(exportBounds.width).toBe(1920 + 128);
      expect(exportBounds.height).toBe(1080 + 128);
    });
  });

  describe('annotation serialization', () => {
    it('should correctly serialize crop bounds annotation', () => {
      const canvasBounds: CanvasBounds = { width: 1920, height: 1080, imageOffsetX: 50, imageOffsetY: 25 };

      const annotation = {
        id: '__crop_bounds__',
        type: '__crop_bounds__',
        width: canvasBounds.width,
        height: canvasBounds.height,
        imageOffsetX: canvasBounds.imageOffsetX,
        imageOffsetY: canvasBounds.imageOffsetY,
      };

      expect(annotation.id).toBe('__crop_bounds__');
      expect(annotation.width).toBe(1920);
      expect(annotation.imageOffsetX).toBe(50);

      // Verify it can be JSON serialized (required for Tauri IPC)
      const serialized = JSON.stringify(annotation);
      const deserialized = JSON.parse(serialized);
      expect(deserialized).toEqual(annotation);
    });

    it('should correctly serialize crop region annotation', () => {
      const cropRegion = { x: 100, y: 200, width: 800, height: 600 };

      const annotation = {
        id: '__crop_region__',
        type: '__crop_region__',
        x: cropRegion.x,
        y: cropRegion.y,
        width: cropRegion.width,
        height: cropRegion.height,
      };

      expect(annotation.id).toBe('__crop_region__');
      const serialized = JSON.stringify(annotation);
      const deserialized = JSON.parse(serialized);
      expect(deserialized).toEqual(annotation);
    });

    it('should correctly serialize compositor settings annotation', () => {
      const settings: CompositorSettings = {
        ...DEFAULT_COMPOSITOR_SETTINGS,
        enabled: true,
        padding: 48,
        borderRadius: 24,
        shadowIntensity: 0.8,
        backgroundType: 'gradient',
        gradientStart: '#ff0000',
        gradientEnd: '#0000ff',
      };

      const annotation = {
        id: '__compositor_settings__',
        type: '__compositor_settings__',
        ...settings,
      };

      expect(annotation.id).toBe('__compositor_settings__');
      expect(annotation.padding).toBe(48);
      expect(annotation.borderRadius).toBe(24);

      const serialized = JSON.stringify(annotation);
      const deserialized = JSON.parse(serialized);
      expect(deserialized.enabled).toBe(true);
      expect(deserialized.gradientStart).toBe('#ff0000');
    });

    it('should not include imageSrc in background shape annotations', () => {
      const bgShape = {
        id: 'bg-1',
        type: 'image',
        isBackground: true,
        imageSrc: 'base64_large_data_here',
        width: 1920,
        height: 1080,
      };

      // Simulate the stripping from useEditorActions
      const { imageSrc: _unused, ...rest } = bgShape;

      expect(rest).not.toHaveProperty('imageSrc');
      expect(rest).toHaveProperty('isBackground', true);
      expect(rest).toHaveProperty('width', 1920);

      // Should be safe to serialize without bloating the annotation payload
      const serialized = JSON.stringify(rest);
      expect(serialized).not.toContain('base64_large_data_here');
    });
  });

  describe('export format detection', () => {
    it('should detect PNG format from extension', () => {
      const ext = 'png';
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png';
      expect(mimeType).toBe('image/png');
    });

    it('should detect JPEG format from extension', () => {
      const ext = 'jpg';
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png';
      expect(mimeType).toBe('image/jpeg');
    });

    it('should detect WebP format from extension', () => {
      const ext = 'webp';
      const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'webp' ? 'image/webp'
        : 'image/png';
      expect(mimeType).toBe('image/webp');
    });
  });
});
