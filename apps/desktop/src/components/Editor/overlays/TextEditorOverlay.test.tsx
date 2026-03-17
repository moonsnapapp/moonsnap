import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TextEditorOverlay } from './TextEditorOverlay';

describe('TextEditorOverlay', () => {
  it('uses border-box sizing so the inline editor matches the text background box', () => {
    const { container } = render(
      <TextEditorOverlay
        position={{
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
        }}
        value=""
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
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
});
