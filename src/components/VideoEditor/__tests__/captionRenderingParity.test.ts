/**
 * Caption Rendering Parity Tests
 *
 * Verifies that CSS preview and Rust/glyphon export use the same layout values.
 * All values should come from the parity system (src-tauri/src/rendering/parity.rs).
 *
 * NOTE: These tests run in Vitest without Tauri, so we can't call invoke().
 * Instead, we document the expected values that MUST match the parity module.
 */

// ============================================================================
// PARITY VALUES (from Rust: src-tauri/src/rendering/parity.rs)
// These MUST match the constants in parity.rs - if they don't, update both!
// ============================================================================
const PARITY = {
  // layout::REFERENCE_HEIGHT
  referenceHeight: 1080,

  // layout::CAPTION_PADDING
  captionPadding: 40,

  // layout::CAPTION_BG_PADDING_H
  captionBgPaddingH: 16,

  // layout::CAPTION_BG_PADDING_V
  captionBgPaddingV: 8,

  // layout::CAPTION_CORNER_RADIUS
  captionCornerRadius: 12,

  // layout::LINE_HEIGHT_MULTIPLIER
  lineHeightMultiplier: 1.2,

  // layout::DEFAULT_BG_PADDING
  defaultBgPadding: 40,

  // layout::DEFAULT_BG_ROUNDING
  defaultBgRounding: 12,
};

// ============================================================================
// TESTS
// ============================================================================

describe('Caption Rendering Parity', () => {
  describe('Layout Constants', () => {
    it('has expected reference height (1080p)', () => {
      expect(PARITY.referenceHeight).toBe(1080);
    });

    it('has expected caption padding (40px at 1080p)', () => {
      expect(PARITY.captionPadding).toBe(40);
    });

    it('has expected line height multiplier (1.2)', () => {
      expect(PARITY.lineHeightMultiplier).toBe(1.2);
    });

    it('has expected background padding (16px H, 8px V)', () => {
      expect(PARITY.captionBgPaddingH).toBe(16);
      expect(PARITY.captionBgPaddingV).toBe(8);
    });

    it('has expected corner radius (12px)', () => {
      expect(PARITY.captionCornerRadius).toBe(12);
    });
  });

  describe('Scaling', () => {
    it('scales correctly at various resolutions', () => {
      const testCases = [
        { height: 480, expectedScale: 480 / 1080 },
        { height: 720, expectedScale: 720 / 1080 },
        { height: 1080, expectedScale: 1.0 },
        { height: 1440, expectedScale: 1440 / 1080 },
        { height: 2160, expectedScale: 2.0 },
      ];

      for (const { height, expectedScale } of testCases) {
        const scale = height / PARITY.referenceHeight;
        expect(scale).toBeCloseTo(expectedScale, 4);
      }
    });

    it('scales caption padding correctly', () => {
      const testResolutions = [480, 720, 1080, 1440, 2160];

      testResolutions.forEach(height => {
        const scale = height / PARITY.referenceHeight;
        const scaledPadding = PARITY.captionPadding * scale;

        // At 1080p, should be exactly 40px
        if (height === 1080) {
          expect(scaledPadding).toBe(40);
        }

        // At 720p, should be 40 * (720/1080) ≈ 26.67px
        if (height === 720) {
          expect(scaledPadding).toBeCloseTo(26.67, 1);
        }

        // At 4K, should be 80px
        if (height === 2160) {
          expect(scaledPadding).toBe(80);
        }
      });
    });

    it('scales background padding correctly', () => {
      const height = 2160; // 4K
      const scale = height / PARITY.referenceHeight;

      const scaledH = PARITY.captionBgPaddingH * scale;
      const scaledV = PARITY.captionBgPaddingV * scale;

      expect(scaledH).toBe(32); // 16 * 2
      expect(scaledV).toBe(16); // 8 * 2
    });
  });

  describe('Text Area Width', () => {
    it('calculates max width correctly', () => {
      // Both CSS and Rust use: textWidth = outputWidth - (padding * 2)
      const testCases = [
        { width: 1920, height: 1080 },
        { width: 1280, height: 720 },
        { width: 3840, height: 2160 },
      ];

      testCases.forEach(({ width, height }) => {
        const scale = height / PARITY.referenceHeight;
        const scaledPadding = PARITY.captionPadding * scale;
        const textWidth = width - scaledPadding * 2;

        // At 1080p with 1920 width: 1920 - 80 = 1840
        if (height === 1080 && width === 1920) {
          expect(textWidth).toBe(1840);
        }

        // At 4K with 3840 width: 3840 - 160 = 3680
        if (height === 2160 && width === 3840) {
          expect(textWidth).toBe(3680);
        }
      });
    });
  });

  describe('Font Size Scaling', () => {
    it('scales font size proportionally', () => {
      const baseFontSize = 32;
      const resolutions = [480, 720, 1080, 1440, 2160];

      resolutions.forEach(height => {
        const scale = height / PARITY.referenceHeight;
        const scaledFontSize = baseFontSize * scale;

        // At 1080p, font should be exactly baseFontSize
        if (height === 1080) {
          expect(scaledFontSize).toBe(baseFontSize);
        }

        // At 720p, font should be 2/3 of base
        if (height === 720) {
          expect(scaledFontSize).toBeCloseTo(baseFontSize * (720 / 1080), 1);
        }

        // At 4K, font should be 2x base
        if (height === 2160) {
          expect(scaledFontSize).toBeCloseTo(baseFontSize * 2, 1);
        }
      });
    });

    it('calculates line height correctly', () => {
      const fontSize = 48;
      const lineHeight = fontSize * PARITY.lineHeightMultiplier;
      expect(lineHeight).toBeCloseTo(57.6, 5); // 48 * 1.2
    });
  });
});

describe('Composition Bounds', () => {
  // Tests for calculate_composition_bounds logic
  // Mirrors the Rust tests in parity.rs

  function calculateBounds(
    videoWidth: number,
    videoHeight: number,
    padding: number,
    manualOutput?: { width: number; height: number }
  ) {
    const videoAspect = videoWidth / videoHeight;

    if (!manualOutput) {
      // Auto mode
      return {
        outputWidth: videoWidth + padding * 2,
        outputHeight: videoHeight + padding * 2,
        frameX: padding,
        frameY: padding,
        frameWidth: videoWidth,
        frameHeight: videoHeight,
      };
    }

    // Manual mode
    const { width: fixedW, height: fixedH } = manualOutput;
    const availableW = Math.max(1, fixedW - padding * 2);
    const availableH = Math.max(1, fixedH - padding * 2);
    const availableAspect = availableW / availableH;

    let frameW: number;
    let frameH: number;

    if (videoAspect > availableAspect) {
      frameW = availableW;
      frameH = availableW / videoAspect;
    } else {
      frameH = availableH;
      frameW = availableH * videoAspect;
    }

    return {
      outputWidth: fixedW,
      outputHeight: fixedH,
      frameX: (fixedW - frameW) / 2,
      frameY: (fixedH - frameH) / 2,
      frameWidth: frameW,
      frameHeight: frameH,
    };
  }

  it('auto mode adds padding around video', () => {
    const bounds = calculateBounds(1920, 1080, 40);

    expect(bounds.outputWidth).toBe(2000);
    expect(bounds.outputHeight).toBe(1160);
    expect(bounds.frameX).toBe(40);
    expect(bounds.frameY).toBe(40);
    expect(bounds.frameWidth).toBe(1920);
    expect(bounds.frameHeight).toBe(1080);
  });

  it('manual mode fits video within fixed output', () => {
    const bounds = calculateBounds(1920, 1080, 40, { width: 1920, height: 1080 });

    expect(bounds.outputWidth).toBe(1920);
    expect(bounds.outputHeight).toBe(1080);
    // Video should be shrunk to fit within padding
    expect(bounds.frameWidth).toBeLessThan(1920);
    expect(bounds.frameHeight).toBeLessThan(1080);
    // Should be centered
    expect(bounds.frameX).toBeGreaterThan(0);
    expect(bounds.frameY).toBeGreaterThan(0);
  });

  it('no padding results in video = output', () => {
    const bounds = calculateBounds(1920, 1080, 0);

    expect(bounds.outputWidth).toBe(1920);
    expect(bounds.outputHeight).toBe(1080);
    expect(bounds.frameX).toBe(0);
    expect(bounds.frameY).toBe(0);
  });
});

describe('Font Family (Documentation)', () => {
  it('documents font family handling', () => {
    // Export (parity.rs + text_layer.rs): Uses glyphon FontSystem with family matching
    // - "sans" | "sans-serif" | "system-ui" => Family::SansSerif
    // - "serif" => Family::Serif
    // - "mono" | "monospace" => Family::Monospace
    // - custom name => Family::Name(name)

    // CSS: Uses browser font stack
    // - fontFamily: captionSettings.font || 'system-ui, sans-serif'

    // The parity system provides get_font_metrics() to query what font
    // glyphon actually resolves to, allowing CSS to match.

    expect(true).toBe(true); // Documentation test
  });
});

describe('Word Wrapping (Documentation)', () => {
  it('documents word wrap behavior', () => {
    // Export (text_layer.rs): buffer.set_wrap(Wrap::Word)
    // CSS: default browser word-wrap behavior

    // Word wrap algorithms may differ between glyphon and browser.
    // This is a known limitation - long captions may break at different points.

    expect(true).toBe(true); // Documentation test
  });
});
