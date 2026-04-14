import { useState, useCallback } from "react";

const DISMISSED_CANDIDATES_KEY = "scan_dismissed_candidates_v1";

function loadDismissedPaths(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISSED_CANDIDATES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set<string>(parsed);
  } catch {
    // Si el JSON está corrupto, resetear
  }
  return new Set();
}

function saveDismissedPaths(paths: Set<string>): void {
  try {
    localStorage.setItem(DISMISSED_CANDIDATES_KEY, JSON.stringify([...paths]));
  } catch {
    // localStorage lleno o no disponible: ignorar silenciosamente
  }
}

export function useDismissedCandidates() {
  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissedPaths());

  const dismiss = useCallback((path: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(path);
      saveDismissedPaths(next);
      return next;
    });
  }, []);

  const restore = useCallback((path: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.delete(path);
      saveDismissedPaths(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    setDismissed(new Set());
    try {
      localStorage.removeItem(DISMISSED_CANDIDATES_KEY);
    } catch {
      // ignorar
    }
  }, []);

  return { dismissed, dismiss, restore, clearAll };
}
