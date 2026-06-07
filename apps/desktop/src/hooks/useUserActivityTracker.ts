import { useEffect, type RefObject } from 'react';

const USER_ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

export function useUserActivityTracker(lastUserActivityAtRef: RefObject<number>) {
  useEffect(() => {
    const markUserActivity = () => {
      lastUserActivityAtRef.current = Date.now();
    };

    window.addEventListener('pointerdown', markUserActivity, { passive: true });
    window.addEventListener('keydown', markUserActivity);
    window.addEventListener('wheel', markUserActivity, { passive: true });
    window.addEventListener('touchstart', markUserActivity, { passive: true });

    return () => {
      for (const eventName of USER_ACTIVITY_EVENTS) {
        window.removeEventListener(eventName, markUserActivity);
      }
    };
  }, [lastUserActivityAtRef]);
}
