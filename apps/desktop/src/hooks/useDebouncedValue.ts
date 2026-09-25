import { useEffect, useState } from "react";

/**
 * Devuelve una versión debounced de un valor, actualizada solo
 * cuando ha pasado `delayMs` sin cambios.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
