'use client';

import type { CSSProperties, ReactNode } from 'react';

type DataTableColumn = {
  key: string;
  label: string;
  width?: string | number;
};

type DataTableProps = {
  columns: DataTableColumn[];
  children: ReactNode; // <tbody> rows
  style?: CSSProperties;
};

/**
 * DataTable — Tabla de datos premium con estilos centralizados en modules.css.
 * Uso: <DataTable columns={[{ key: 'nrc', label: 'NRC' }]}>
 *        <tr><td>72305</td></tr>
 *      </DataTable>
 */
export function DataTable({ columns, children, style }: DataTableProps) {
  return (
    <div className="ds-table-wrap" style={style}>
      <table className="ds-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={col.width ? { width: col.width } : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
