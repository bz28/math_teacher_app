/**
 * Poll an accessor function until it returns a truthy value or times out.
 * Returns the value if found, or null on timeout.
 */
export function pollForState<T>(
  accessor: () => T | undefined | null,
  timeoutMs: number,
  intervalMs = 500,
): Promise<T | null> {
  return new Promise((resolve) => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      if (interval) clearInterval(interval);
      resolve(null);
    }, timeoutMs);
    const check = () => {
      const value = accessor();
      if (value) {
        clearTimeout(timeout);
        if (interval) clearInterval(interval);
        resolve(value);
        return true;
      }
      return false;
    };
    if (!check()) {
      interval = setInterval(() => {
        check();
      }, intervalMs);
    }
  });
}
