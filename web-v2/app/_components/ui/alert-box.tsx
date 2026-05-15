'use client';

import React from 'react';

export type AlertTone = 'info' | 'success' | 'warn' | 'error';

export interface AlertBoxProps {
  tone?: AlertTone;
  icon?: React.ReactNode;
  message?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const AlertBox: React.FC<AlertBoxProps> = ({
  tone = 'info',
  icon,
  message,
  children,
  className = '',
  style,
}) => {
  // Autoresolver icono si no se pasa explícitamente
  let defaultIcon = 'ⓘ';
  if (tone === 'success') defaultIcon = '✓';
  if (tone === 'warn') defaultIcon = '⚠';
  if (tone === 'error') defaultIcon = '⚠';

  const isLive = tone === 'error' || tone === 'warn';

  return (
    <div
      className={`ds-alert ${tone} ${className}`.trim()}
      style={style}
      role={isLive ? 'alert' : 'status'}
      aria-live={isLive ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <span className="ds-alert-icon" aria-hidden="true">{icon || defaultIcon}</span>
      <div className="ds-alert-content">{message || children}</div>
    </div>
  );
};
