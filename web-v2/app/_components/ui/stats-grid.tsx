'use client';

import type { CSSProperties } from 'react';

type StatItem = {
  label: string;
  value: string | number;
  help?: string;
  tone?: 'default' | 'ok' | 'warn' | 'danger';
};

type StatsGridProps = {
  items: StatItem[];
  columns?: number;
  style?: CSSProperties;
};

/**
 * StatsGrid — Grid de tarjetas de estadísticas con micro-animación hover.
 * Uso: <StatsGrid items={[{ label: 'Total', value: 120, tone: 'ok' }]} />
 */
export function StatsGrid({ items, columns = 4, style }: StatsGridProps) {
  const colOverride = columns !== 4 ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : {};
  return (
    <div
      className="ds-stats-grid"
      style={{ ...colOverride, ...style }}
    >
      {items.map((item, i) => (
        <div key={i} className={`ds-stat-card ${item.tone ?? ''}`}>
          <div className="ds-stat-lbl">{item.label}</div>
          <div className="ds-stat-val">
            {typeof item.value === 'number' ? item.value.toLocaleString('es-CO') : item.value}
          </div>
          {item.help ? <div className="ds-stat-hlp">{item.help}</div> : null}
        </div>
      ))}
    </div>
  );
}
