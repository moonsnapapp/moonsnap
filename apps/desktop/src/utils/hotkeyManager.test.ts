import { describe, it, expect } from 'vitest';
import {
  isValidShortcut,
  normalizeShortcut,
  parseKeyboardEvent,
  isEditableEventTarget,
  matchesShortcutEvent,
  formatShortcutForDisplay,
  validateShortcutString,
} from './hotkeyManager';

// ---------------------------------------------------------------------------
// isValidShortcut
// ---------------------------------------------------------------------------

describe('isValidShortcut', () => {
  it('accepts well-formed modifier+key combinations', () => {
    expect(isValidShortcut('Ctrl+Shift+S')).toBe(true);
    expect(isValidShortcut('Alt+F4')).toBe(true);
  });

  it('accepts a bare special key with no modifier', () => {
    expect(isValidShortcut('PrintScreen')).toBe(true);
  });

  it('is case-insensitive for modifiers and keys', () => {
    expect(isValidShortcut('ctrl+shift+s')).toBe(true);
  });

  it('treats any single character as a valid key', () => {
    expect(isValidShortcut('Ctrl+;')).toBe(true);
  });

  it('rejects empty input', () => {
    expect(isValidShortcut('')).toBe(false);
  });

  it('rejects unknown modifiers', () => {
    expect(isValidShortcut('Foo+S')).toBe(false);
  });

  it('rejects a multi-character key that is not in the known list', () => {
    expect(isValidShortcut('Ctrl+NotAKey')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeShortcut
// ---------------------------------------------------------------------------

describe('normalizeShortcut', () => {
  it('canonicalises control/ctrl to Ctrl and uppercases the key', () => {
    expect(normalizeShortcut('control+shift+s')).toBe('Ctrl+Shift+S');
    expect(normalizeShortcut('CTRL+a')).toBe('Ctrl+A');
  });

  it('maps meta to Command', () => {
    expect(normalizeShortcut('meta+c')).toBe('Command+C');
  });

  it('preserves CommandOrControl and Super', () => {
    expect(normalizeShortcut('commandorcontrol+x')).toBe('CommandOrControl+X');
    expect(normalizeShortcut('super+f1')).toBe('Super+F1');
  });

  it('passes unknown modifiers through unchanged', () => {
    expect(normalizeShortcut('foo+a')).toBe('foo+A');
  });
});

// ---------------------------------------------------------------------------
// parseKeyboardEvent
// ---------------------------------------------------------------------------

describe('parseKeyboardEvent', () => {
  it('builds a shortcut string from modifiers and key', () => {
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true });
    expect(parseKeyboardEvent(event)).toBe('Ctrl+Shift+S');
  });

  it('treats the meta key as Ctrl', () => {
    const event = new KeyboardEvent('keydown', { key: 'c', metaKey: true });
    expect(parseKeyboardEvent(event)).toBe('Ctrl+C');
  });

  it('maps the space key to the Space token', () => {
    const event = new KeyboardEvent('keydown', { key: ' ', altKey: true, shiftKey: true });
    expect(parseKeyboardEvent(event)).toBe('Alt+Shift+Space');
  });

  it('returns null for modifier-only presses', () => {
    expect(parseKeyboardEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }))).toBeNull();
  });

  it('returns null when no modifier is held', () => {
    expect(parseKeyboardEvent(new KeyboardEvent('keydown', { key: 'a' }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isEditableEventTarget
// ---------------------------------------------------------------------------

describe('isEditableEventTarget', () => {
  it('returns false for null or non-element targets', () => {
    expect(isEditableEventTarget(null)).toBe(false);
    expect(isEditableEventTarget(new EventTarget())).toBe(false);
  });

  it('returns true for form input elements', () => {
    expect(isEditableEventTarget(document.createElement('input'))).toBe(true);
    expect(isEditableEventTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableEventTarget(document.createElement('select'))).toBe(true);
  });

  it('returns false for non-editable elements', () => {
    expect(isEditableEventTarget(document.createElement('div'))).toBe(false);
    expect(isEditableEventTarget(document.createElement('button'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// matchesShortcutEvent
// ---------------------------------------------------------------------------

describe('matchesShortcutEvent', () => {
  it('matches when key and all modifiers line up exactly', () => {
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true });
    expect(matchesShortcutEvent(event, 'Ctrl+S')).toBe(true);
  });

  it('does not match when an extra modifier is held', () => {
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true });
    expect(matchesShortcutEvent(event, 'Ctrl+S')).toBe(false);
  });

  it('does not match when the key differs', () => {
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true });
    expect(matchesShortcutEvent(event, 'Ctrl+S')).toBe(false);
  });

  it('matches a bare special key with no modifiers', () => {
    const event = new KeyboardEvent('keydown', { key: 'PrintScreen' });
    expect(matchesShortcutEvent(event, 'PrintScreen')).toBe(true);
  });

  it('treats CommandOrControl as the ctrl requirement', () => {
    const event = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true });
    expect(matchesShortcutEvent(event, 'CommandOrControl+Shift+S')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatShortcutForDisplay
// ---------------------------------------------------------------------------

describe('formatShortcutForDisplay', () => {
  it('renders CommandOrControl as Ctrl', () => {
    expect(formatShortcutForDisplay('CommandOrControl+Shift+S')).toBe('Ctrl+Shift+S');
  });

  it('renders Command as the command symbol', () => {
    expect(formatShortcutForDisplay('Command+C')).toBe('⌘+C');
  });

  it('renders Control as Ctrl', () => {
    expect(formatShortcutForDisplay('Control+A')).toBe('Ctrl+A');
  });

  it('leaves Alt and Shift untouched', () => {
    expect(formatShortcutForDisplay('Alt+Shift+Tab')).toBe('Alt+Shift+Tab');
  });
});

// ---------------------------------------------------------------------------
// validateShortcutString
// ---------------------------------------------------------------------------

describe('validateShortcutString', () => {
  it('rejects empty input with a clear message', () => {
    expect(validateShortcutString('')).toEqual({ valid: false, error: 'Shortcut cannot be empty' });
  });

  it('accepts a combination that contains a non-modifier key', () => {
    expect(validateShortcutString('Ctrl+Shift+S')).toEqual({ valid: true });
  });

  it('accepts a bare key with no modifiers', () => {
    expect(validateShortcutString('S')).toEqual({ valid: true });
  });

  it('rejects a modifier-only combination', () => {
    expect(validateShortcutString('Ctrl+Shift')).toEqual({
      valid: false,
      error: 'Shortcut must contain at least one non-modifier key',
    });
  });
});
