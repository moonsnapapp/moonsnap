import { TIMING } from '@/constants';

interface MutableBooleanRef {
  current: boolean;
}

export function scheduleImageEditorAutosaveEnable(isInitialLoadRef: MutableBooleanRef) {
  return setTimeout(() => {
    isInitialLoadRef.current = false;
  }, TIMING.IMAGE_EDITOR_INITIAL_LOAD_GUARD_MS);
}
