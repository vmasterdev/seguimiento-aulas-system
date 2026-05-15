'use client';

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

export type VirtualTableColumn<T> = {
  /** Unique key. Used for React key and width tracking. */
  key: string;
  /** Header label. */
  header: ReactNode;
  /** Cell renderer. */
  render: (row: T, index: number) => ReactNode;
  /** CSS grid track size — e.g. '120px', '1fr', 'minmax(80px, 1fr)'. Default: '1fr'. */
  width?: string;
  /** Text align for header + cells. Default: 'left'. */
  align?: 'left' | 'center' | 'right';
};

type VirtualTableProps<T> = {
  rows: T[];
  columns: VirtualTableColumn<T>[];
  /** Stable id per row. Required for keys, selection, expansion. */
  rowKey: (row: T, index: number) => string;
  /** Fixed height of each row in px. Default: 38. */
  rowHeight?: number;
  /** Max height of the scroll viewport in px. Default: 560. */
  maxHeight?: number;
  /** Extra rows rendered above/below viewport. Default: 8. */
  overscan?: number;
  /** Renders an expanded detail panel below the row. Return null to skip. */
  renderExpanded?: (row: T, index: number) => ReactNode;
  /** Set of expanded row keys. */
  expandedKeys?: Set<string>;
  /** Set of selected row keys — applies selected styling. */
  selectedKeys?: Set<string>;
  /** Row click handler. */
  onRowClick?: (row: T, index: number) => void;
  /** Empty-state content when rows is empty. */
  emptyState?: ReactNode;
  /** Below this row count, skips virtualization (renders all). Default: 200. */
  virtualizeThreshold?: number;
  style?: CSSProperties;
  className?: string;
};

/**
 * VirtualTable — Tabla virtualizada para listados densos grandes (>200 filas).
 *
 * - Sin librería externa: windowing manual sobre scroll.
 * - Soporta filas expandibles (renderExpanded), selección y click.
 * - Por debajo de virtualizeThreshold renderiza todo (evita overhead innecesario).
 * - Estilos en modules.css (.vt-*).
 *
 * Uso:
 *   <VirtualTable
 *     rows={items}
 *     rowKey={(r) => r.id}
 *     columns={[
 *       { key: 'nrc', header: 'NRC', width: '110px', render: (r) => r.nrc },
 *       { key: 'name', header: 'Materia', render: (r) => r.subjectName },
 *     ]}
 *   />
 *
 * NOTA: con filas expandibles activas, la virtualización se desactiva
 * (alturas variables). Para listados enormes, expandir de a una fila.
 */
export function VirtualTable<T>({
  rows,
  columns,
  rowKey,
  rowHeight = 38,
  maxHeight = 560,
  overscan = 8,
  renderExpanded,
  expandedKeys,
  selectedKeys,
  onRowClick,
  emptyState,
  virtualizeThreshold = 200,
  style,
  className,
}: VirtualTableProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportH, setViewportH] = useState(maxHeight);

  const gridTemplate = useMemo(
    () => columns.map((c) => c.width ?? '1fr').join(' '),
    [columns],
  );

  const hasExpanded = !!renderExpanded && !!expandedKeys && expandedKeys.size > 0;
  // Variable row heights when something is expanded → can't window safely.
  const virtualize = rows.length > virtualizeThreshold && !hasExpanded;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => setViewportH(el.clientHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  const { startIndex, endIndex, padTop, padBottom } = useMemo(() => {
    if (!virtualize) {
      return { startIndex: 0, endIndex: rows.length, padTop: 0, padBottom: 0 };
    }
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(viewportH / rowHeight) + overscan * 2;
    const end = Math.min(rows.length, start + visibleCount);
    return {
      startIndex: start,
      endIndex: end,
      padTop: start * rowHeight,
      padBottom: (rows.length - end) * rowHeight,
    };
  }, [virtualize, scrollTop, rowHeight, viewportH, overscan, rows.length]);

  const visibleRows = rows.slice(startIndex, endIndex);

  return (
    <div className={`vt-wrap${className ? ` ${className}` : ''}`} style={style}>
      <div
        className="vt-header"
        style={{ gridTemplateColumns: gridTemplate }}
        role="row"
      >
        {columns.map((col) => (
          <div
            key={col.key}
            className="vt-th"
            style={{ textAlign: col.align ?? 'left' }}
            role="columnheader"
          >
            {col.header}
          </div>
        ))}
      </div>

      <div
        ref={scrollRef}
        className="vt-scroll"
        style={{ maxHeight }}
        onScroll={virtualize ? onScroll : undefined}
      >
        {rows.length === 0 ? (
          <div className="vt-empty">{emptyState ?? 'Sin registros.'}</div>
        ) : (
          <>
            {padTop > 0 ? <div style={{ height: padTop }} aria-hidden /> : null}
            {visibleRows.map((row, i) => {
              const realIndex = startIndex + i;
              const key = rowKey(row, realIndex);
              const isSelected = selectedKeys?.has(key) ?? false;
              const isExpanded = expandedKeys?.has(key) ?? false;
              const expandedContent =
                isExpanded && renderExpanded ? renderExpanded(row, realIndex) : null;
              return (
                <div key={key} className="vt-row-group">
                  <div
                    className={`vt-row${isSelected ? ' vt-row-selected' : ''}${
                      onRowClick ? ' vt-row-clickable' : ''
                    }`}
                    style={{ gridTemplateColumns: gridTemplate, height: rowHeight }}
                    role="row"
                    onClick={onRowClick ? () => onRowClick(row, realIndex) : undefined}
                  >
                    {columns.map((col) => (
                      <div
                        key={col.key}
                        className="vt-td"
                        style={{ textAlign: col.align ?? 'left' }}
                        role="cell"
                      >
                        {col.render(row, realIndex)}
                      </div>
                    ))}
                  </div>
                  {expandedContent ? (
                    <div className="vt-expanded">{expandedContent}</div>
                  ) : null}
                </div>
              );
            })}
            {padBottom > 0 ? (
              <div style={{ height: padBottom }} aria-hidden />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
