import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextEditorOverlay } from './TextEditorOverlay';

describe('TextEditorOverlay', () => {
  const position = {
    left: 120,
    top: 80,
    width: 320,
    height: 54,
    fontSize: 36,
    fontFamily: 'Arial',
    fontStyle: 'normal',
    textDecoration: '',
    align: 'left',
    verticalAlign: 'top',
    color: '#111111',
    textBackground: '#ffffff',
    textBoxStroke: 'transparent',
    textBoxStrokeWidth: 0,
  };

  it('uses border-box sizing so the inline editor matches the text background box', () => {
    const { container } = render(
      <TextEditorOverlay
        position={position}
        value=""
        onChange={vi.fn()}
        onSave={vi.fn()}
      />
    );

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement | null;

    expect(editor).toBeInTheDocument();
    expect(editor?.style.left).toBe('120px');
    expect(editor?.style.top).toBe('80px');
    expect(editor?.style.width).toBe('320px');
    expect(editor?.style.minHeight).toBe('54px');
    expect(editor?.style.boxSizing).toBe('border-box');
    expect(editor?.style.padding).toBe('4px');
    expect(editor?.style.borderTopStyle).toBe('dashed');
    expect(editor?.style.borderTopWidth).toBe('1px');
    expect(editor?.style.background).toBe('rgb(255, 255, 255)');
  });

  it('saves instead of cancelling when Escape is pressed', () => {
    const onSave = vi.fn();
    const { container } = render(
      <TextEditorOverlay
        position={position}
        value="draft text"
        onChange={vi.fn()}
        onSave={onSave}
      />
    );

    const editor = container.querySelector('[contenteditable="true"]') as HTMLDivElement;
    Object.defineProperty(editor, 'scrollHeight', {
      configurable: true,
      value: 72,
    });

    fireEvent.keyDown(editor, { key: 'Escape' });

    expect(onSave).toHaveBeenCalledWith(72);
  });
});
