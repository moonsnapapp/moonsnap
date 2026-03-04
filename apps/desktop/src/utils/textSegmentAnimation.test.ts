import { describe, expect, it } from 'vitest';
import type { TextSegment } from '@/types';
import {
  getEffectiveTypewriterCharsPerSecond,
  getAnimatedTextContent,
  getTypewriterCharsPerSecond,
  getTypewriterTypingEndSec,
  hasActiveTypewriterSound,
  isTypewriterSoundEnabled,
  normalizeTextAnimation,
} from './textSegmentAnimation';

const baseSegment: TextSegment = {
  start: 2,
  end: 8,
  enabled: true,
  content: 'Hello',
  center: { x: 0.5, y: 0.5 },
  size: { x: 0.35, y: 0.2 },
  fontFamily: 'sans-serif',
  fontSize: 48,
  fontWeight: 700,
  italic: false,
  color: '#ffffff',
  fadeDuration: 0.15,
};

describe('textSegmentAnimation', () => {
  it('normalizes legacy typewriter mode', () => {
    expect(normalizeTextAnimation('typewriter')).toBe('typeWriter');
  });

  it('normalizes legacy fade modes to default', () => {
    expect(normalizeTextAnimation('fadeIn')).toBe('none');
    expect(normalizeTextAnimation('fadeOut')).toBe('none');
    expect(normalizeTextAnimation('fadeInOut')).toBe('none');
  });

  it('returns full content for non-typewriter animations', () => {
    expect(getAnimatedTextContent(baseSegment, 2.1)).toBe('Hello');
  });

  it('reveals text progressively for typewriter animation', () => {
    const segment: TextSegment = {
      ...baseSegment,
      animation: 'typeWriter',
      typewriterCharsPerSecond: 2,
    };

    expect(getAnimatedTextContent(segment, 2)).toBe('');
    expect(getAnimatedTextContent(segment, 3)).toBe('He');
    expect(getAnimatedTextContent(segment, 4.5)).toBe('Hello');
  });

  it('clamps typewriter speed to configured bounds', () => {
    const slowSegment: TextSegment = {
      ...baseSegment,
      animation: 'typeWriter',
      typewriterCharsPerSecond: 0,
    };
    const fastSegment: TextSegment = {
      ...baseSegment,
      animation: 'typeWriter',
      typewriterCharsPerSecond: 1000,
    };

    expect(getTypewriterCharsPerSecond(slowSegment)).toBe(1);
    expect(getTypewriterCharsPerSecond(fastSegment)).toBe(60);
  });

  it('applies a minimum sound tail trim for very fast typing speeds', () => {
    const segment: TextSegment = {
      ...baseSegment,
      start: 0,
      end: 5,
      content: '01234567890123456789',
      animation: 'typeWriter',
      typewriterCharsPerSecond: 60,
    };

    // 20 / 60 = 0.3333s reveal, minus max(1/60, 0.10) = 0.10s trim.
    expect(getTypewriterTypingEndSec(segment)).toBeCloseTo(0.233333, 5);
  });

  it('auto-boosts typing speed so full text appears before fade-out window', () => {
    const segment: TextSegment = {
      ...baseSegment,
      start: 0,
      end: 2,
      fadeDuration: 0.5,
      content: '0123456789',
      animation: 'typeWriter',
      typewriterCharsPerSecond: 1,
    };

    // typing window = 2.0 - 0.5 = 1.5s, so minimum needed = 10 / 1.5 = 6.66...
    expect(getEffectiveTypewriterCharsPerSecond(segment)).toBeGreaterThan(6.6);
    expect(getAnimatedTextContent(segment, 1.5)).toBe('0123456789');
  });

  it('normalises whitespace for typewriter pacing to match renderer', () => {
    const segment: TextSegment = {
      ...baseSegment,
      start: 0,
      end: 5,
      content: 'Hello   \n\tworld',
      animation: 'typeWriter',
      typewriterCharsPerSecond: 5,
    };

    // Renderer collapses whitespace: "Hello   \n\tworld" → "Hello world" (11 graphemes)
    // 11 / 5 chars/s = 2.2s reveal, minus one keystroke (0.2s) = 2.0s sound end
    expect(getTypewriterTypingEndSec(segment)).toBeCloseTo(2.0, 5);
    // But all chars are still revealed by 2.2s
    expect(getAnimatedTextContent(segment, 2.3)).toBe('Hello world');
  });

  it('reveals extended grapheme clusters as single typing units', () => {
    const segment: TextSegment = {
      ...baseSegment,
      start: 0,
      end: 5,
      content: '👨‍👩‍👧‍👦!',
      animation: 'typeWriter',
      typewriterCharsPerSecond: 1,
    };

    // 2 graphemes / 1 cps = 2s reveal, minus one keystroke (1s) = 1s sound end
    expect(getTypewriterTypingEndSec(segment)).toBeCloseTo(1, 5);
    expect(getAnimatedTextContent(segment, 0.9)).toBe('');
    expect(getAnimatedTextContent(segment, 1.1)).toBe('👨‍👩‍👧‍👦');
    expect(getAnimatedTextContent(segment, 2.1)).toBe('👨‍👩‍👧‍👦!');
  });

  it('enables typewriter sound only when explicitly toggled on', () => {
    expect(isTypewriterSoundEnabled({
      ...baseSegment,
      animation: 'typeWriter',
      typewriterSoundEnabled: true,
    })).toBe(true);

    expect(isTypewriterSoundEnabled({
      ...baseSegment,
      animation: 'typeWriter',
      typewriterSoundEnabled: false,
    })).toBe(false);
  });

  it('detects active typewriter sound segments at a given time', () => {
    const segments: TextSegment[] = [
      {
        ...baseSegment,
        start: 1,
        end: 5,
        content: 'Hi',
        animation: 'typeWriter',
        typewriterCharsPerSecond: 2,
        typewriterSoundEnabled: true,
      },
      {
        ...baseSegment,
        start: 4,
        end: 5,
        animation: 'none',
        typewriterSoundEnabled: true,
      },
    ];

    // "Hi" at 2 chars/sec: reveal = 2/2 = 1s, minus one keystroke (0.5s) = 0.5s sound
    // Sound plays from t=1 to t=1.5
    expect(getTypewriterTypingEndSec(segments[0])).toBe(1.5);
    expect(hasActiveTypewriterSound(segments, 1.25)).toBe(true);
    expect(hasActiveTypewriterSound(segments, 1.6)).toBe(false);
    expect(hasActiveTypewriterSound(segments, 3.5)).toBe(false);
    expect(hasActiveTypewriterSound(segments, 4.5)).toBe(false);
  });
});
