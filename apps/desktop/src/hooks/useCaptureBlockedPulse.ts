import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';

const CAPTURE_BLOCKED_EVENT = 'capture-blocked-while-recording';
const CAPTURE_BLOCKED_PULSE_DURATION_MS = 220;

export function useCaptureBlockedPulse() {
  const [isActive, setIsActive] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const clearPulseTimers = () => {
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const triggerPulse = () => {
      clearPulseTimers();
      setIsActive(false);

      rafRef.current = window.requestAnimationFrame(() => {
        setIsActive(true);
        timeoutRef.current = window.setTimeout(() => {
          setIsActive(false);
          timeoutRef.current = null;
        }, CAPTURE_BLOCKED_PULSE_DURATION_MS);
      });
    };

    const unlisten = listen(CAPTURE_BLOCKED_EVENT, () => {
      triggerPulse();
    });

    return () => {
      clearPulseTimers();
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, []);

  return isActive;
}
