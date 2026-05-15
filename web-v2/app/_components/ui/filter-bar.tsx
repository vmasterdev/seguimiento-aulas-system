'use client';

import type { CSSProperties, ReactNode } from 'react';

type FilterBarProps = {
  children: ReactNode;
  style?: CSSProperties;
};

/**
 * FilterBar — Contenedor de filtros con layout responsive y estilo unificado en modules.css.
 * Uso: <FilterBar>
 *        <Field label="Periodo"><select>...</select></Field>
 *      </FilterBar>
 */
export function FilterBar({ children, style }: FilterBarProps) {
  return (
    <div className="ds-filter-bar" style={style}>
      {children}
    </div>
  );
}
