import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_FONT_FAMILIES } from '@/types';

let systemFontsCache: string[] | null = null;
let systemFontsRequest: Promise<string[]> | null = null;

export function getSystemFontsSnapshot(): string[] | null {
  return systemFontsCache;
}

export async function getSystemFonts(): Promise<string[]> {
  if (systemFontsCache) return systemFontsCache;
  if (systemFontsRequest) return systemFontsRequest;

  systemFontsRequest = invoke<string[]>('get_system_fonts')
    .then((fonts) => {
      if (fonts && fonts.length > 0) {
        systemFontsCache = fonts;
        return fonts;
      }
      return [...DEFAULT_FONT_FAMILIES];
    })
    .catch(() => {
      return [...DEFAULT_FONT_FAMILIES];
    })
    .finally(() => {
      systemFontsRequest = null;
    });

  return systemFontsRequest;
}
