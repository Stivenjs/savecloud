import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface UseNativeVirtualGridOptions<T> {
  /** Array of items to virtualize */
  items: T[];
  /** Minimum width for an item column (in pixels), e.g. 280 for desktop, 320 for console */
  minItemWidth: number;
  /** Gap between items in pixels (e.g. 20 for gap-5) */
  gap?: number;
  /** Initial estimated height for each row including gap (in pixels) */
  estimatedRowHeight?: number;
  /** Extra rows to render above and below visible viewport */
  overscan?: number;
  /** Initial scroll position if restoring from a previously saved scroll */
  initialScrollY?: number;
}

export interface VisibleGridItem<T> {
  item: T;
  index: number;
}

export interface UseNativeVirtualGridResult<T> {
  containerRef: React.RefObject<HTMLDivElement | null>;
  visibleItems: VisibleGridItem<T>[];
  topPadding: number;
  bottomPadding: number;
  columns: number;
  totalRows: number;
  totalHeight: number;
}

export function useNativeVirtualGrid<T>({
  items,
  minItemWidth,
  gap = 20,
  estimatedRowHeight = 235,
  overscan = 4,
  initialScrollY = 0,
}: UseNativeVirtualGridOptions<T>): UseNativeVirtualGridResult<T> {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [containerWidth, setContainerWidth] = useState<number>(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth;
    }
    return 1200;
  });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const width = entry.contentRect.width || el.clientWidth;
        if (width > 0) {
          setContainerWidth((prev) => (Math.abs(prev - width) > 2 ? width : prev));
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => {
    if (containerWidth <= 0 || minItemWidth <= 0) return 1;
    const computed = Math.floor((containerWidth + gap) / (minItemWidth + gap));
    return Math.max(1, computed);
  }, [containerWidth, minItemWidth, gap]);

  const rowHeight = useMemo(() => {
    if (containerWidth <= 0 || columns <= 0) {
      return estimatedRowHeight;
    }
    const columnWidth = (containerWidth - (columns - 1) * gap) / columns;
    const imageHeight = Math.round(columnWidth * (215 / 460));
    // imageHeight + 8px card gap + 72px/104px actions slot + 2px border + 20px grid gap
    const extraContentHeight = minItemWidth >= 320 ? 114 : 82;
    const computed = imageHeight + extraContentHeight + gap;
    return computed > 100 ? computed : estimatedRowHeight;
  }, [containerWidth, columns, gap, minItemWidth, estimatedRowHeight]);

  const totalRows = useMemo(() => {
    if (columns <= 0 || items.length === 0) return 0;
    return Math.ceil(items.length / columns);
  }, [items.length, columns]);

  // Inicializar directamente en el rango de scroll objetivo para evitar saltos al volver del detalle
  const [rowRange, setRowRange] = useState<{ startRow: number; endRow: number }>(() => {
    const targetY =
      initialScrollY > 0
        ? initialScrollY
        : typeof window !== "undefined"
          ? window.scrollY || document.documentElement.scrollTop || 0
          : 0;

    if (targetY > 0) {
      const relativeScrollY = Math.max(0, targetY - 450);
      const start = Math.max(0, Math.floor(relativeScrollY / estimatedRowHeight) - overscan);
      const end = start + 12 + overscan * 2;
      return { startRow: start, endRow: end };
    }
    return {
      startRow: 0,
      endRow: Math.min(totalRows > 0 ? totalRows : 16, 16),
    };
  });

  const rowRangeRef = useRef(rowRange);

  const updateRange = useCallback(() => {
    const container = containerRef.current;
    if (!container || totalRows === 0) {
      if (rowRangeRef.current.startRow !== 0 || rowRangeRef.current.endRow !== 0) {
        rowRangeRef.current = { startRow: 0, endRow: 0 };
        setRowRange({ startRow: 0, endRow: 0 });
      }
      return;
    }

    const rect = container.getBoundingClientRect();
    const windowScrollY = window.scrollY || document.documentElement.scrollTop;
    const containerTop = rect.top + windowScrollY;
    const viewportHeight = window.innerHeight || 800;

    const relativeScrollY = Math.max(0, windowScrollY - containerTop);

    const start = Math.max(0, Math.floor(relativeScrollY / rowHeight) - overscan);
    const end = Math.min(
      totalRows,
      Math.max(0, Math.floor((relativeScrollY + viewportHeight) / rowHeight) + overscan + 1)
    );

    if (rowRangeRef.current.startRow !== start || rowRangeRef.current.endRow !== end) {
      rowRangeRef.current = { startRow: start, endRow: end };
      setRowRange({ startRow: start, endRow: end });
    }
  }, [totalRows, rowHeight, overscan]);

  useEffect(() => {
    let rafId: number | null = null;

    const handleScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        updateRange();
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleScroll, { passive: true });

    updateRange();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleScroll);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [updateRange]);

  // Usar useLayoutEffect para actualizar filas ANTES de pintar en pantalla
  useLayoutEffect(() => {
    updateRange();
  }, [totalRows, columns, rowHeight, updateRange]);

  const effectiveStartRow = Math.min(rowRange.startRow, Math.max(0, totalRows - 1));
  const effectiveEndRow = Math.min(rowRange.endRow, totalRows);

  const startIndex = effectiveStartRow * columns;
  const endIndex = Math.min(items.length, effectiveEndRow * columns);

  const topPadding = effectiveStartRow * rowHeight;
  const bottomPadding = Math.max(0, (totalRows - effectiveEndRow) * rowHeight);
  const totalHeight = totalRows * rowHeight;

  const visibleItems: VisibleGridItem<T>[] = useMemo(() => {
    if (items.length === 0) return [];
    const slice: VisibleGridItem<T>[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      if (items[i] !== undefined) {
        slice.push({ item: items[i], index: i });
      }
    }
    return slice;
  }, [items, startIndex, endIndex]);

  return {
    containerRef,
    visibleItems,
    topPadding,
    bottomPadding,
    columns,
    totalRows,
    totalHeight,
  };
}
