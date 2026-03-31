import { useEffect, useState } from "react";

/** 5 minutes — threshold at which the timer turns red */
export const LOW_TIME_THRESHOLD_SECONDS = 300;

interface MockTimerOptions {
  startedAt: number;
  timeLimitSeconds: number | null;
  onTimeUp: () => void;
}

/**
 * Countdown timer hook for mock tests.
 * Returns remainingSeconds (null if untimed) and isTimeLow flag.
 */
export function useMockTimer({ startedAt, timeLimitSeconds, onTimeUp }: MockTimerOptions) {
  const [remainingSeconds, setRemainingSeconds] = useState<number | null>(null);

  // Initialize timer
  useEffect(() => {
    if (timeLimitSeconds == null) return;
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    setRemainingSeconds(Math.max(0, timeLimitSeconds - elapsed));
  }, [startedAt, timeLimitSeconds]);

  // Countdown
  useEffect(() => {
    if (remainingSeconds == null || remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev == null || prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSeconds]);

  // Fire callback on time up
  useEffect(() => {
    if (remainingSeconds === 0) onTimeUp();
  }, [remainingSeconds]);

  const isTimeLow =
    remainingSeconds != null &&
    remainingSeconds <= LOW_TIME_THRESHOLD_SECONDS &&
    remainingSeconds > 0;

  return { remainingSeconds, isTimeLow };
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
