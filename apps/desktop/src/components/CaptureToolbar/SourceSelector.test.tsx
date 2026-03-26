import { act, fireEvent, render, screen } from '@testing-library/react';
import { Menu } from '@tauri-apps/api/menu';
import { beforeEach, describe, expect, it, type Mock } from 'vitest';

import { SourceSelector } from './SourceSelector';
import { clearInvokeResponses, setInvokeResponse } from '@/test/mocks/tauri';

const mockMenuNew = Menu.new as unknown as Mock;

describe('SourceSelector area menu', () => {
  beforeEach(() => {
    mockMenuNew.mockClear();
    clearInvokeResponses();
    setInvokeResponse('get_monitors', []);
  });

  it('keeps saved areas at the root and groups deletion into a submenu', async () => {
    render(
      <SourceSelector
        onSelectArea={() => {}}
        onSelectLastArea={() => {}}
        onSelectSavedArea={() => {}}
        onDeleteSavedArea={() => {}}
        savedAreaSelections={[
          {
            id: 'area-1',
            name: 'Area 1',
            x: 10,
            y: 20,
            width: 1280,
            height: 720,
            createdAt: '2026-03-26T00:00:00.000Z',
            updatedAt: '2026-03-26T00:00:00.000Z',
          },
          {
            id: 'area-2',
            name: 'Area 2',
            x: 100,
            y: 200,
            width: 800,
            height: 600,
            createdAt: '2026-03-26T00:00:00.000Z',
            updatedAt: '2026-03-26T00:00:00.000Z',
          },
        ]}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByTitle('Area options'));
    });

    expect(mockMenuNew).toHaveBeenCalledTimes(1);

    const [{ items }] = mockMenuNew.mock.calls[0] as [{ items: Array<Record<string, unknown>> }];
    const rootSavedAreas = items.filter((item) => String(item.id).startsWith('saved-area-'));
    const deleteSubmenu = items.find((item) => item.id === 'delete-saved-area-submenu') as {
      text: string;
      items: Array<{ text: string }>;
    };

    expect(rootSavedAreas).toHaveLength(2);
    expect(rootSavedAreas.map((item) => item.text)).toEqual([
      'Area 1 (1280x720 at 10, 20)',
      'Area 2 (800x600 at 100, 200)',
    ]);
    expect(deleteSubmenu.text).toBe('Delete Saved Area');
    expect(deleteSubmenu.items.map((item) => item.text)).toEqual(['Area 1', 'Area 2']);
  });
});
