'use client';

import React from 'react';

export type PillTone = 'ok' | 'warn' | 'danger' | 'neutral';
export type PillVariant = 'light' | 'dark';

export interface StatusPillProps {
  tone?: PillTone;
  variant?: PillVariant;
  dot?: boolean;
  label?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  tone = 'neutral',
  variant = 'light',
  dot = false,
  label,
  children,
  className = '',
  style,
}) => {
  return (
    <span
      className={`ds-pill ${tone} ${variant} ${className}`.trim()}
      style={style}
    >
      {dot ? (
        <span className="ds-pill-dot" />
      ) : null}
      {label || children}

      <style jsx>{`
        .ds-pill-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: currentColor;
          display: inline-block;
          flex-shrink: 0;
        }
        :global(.ds-pill.warn) .ds-pill-dot {
          animation: ui-dot-pulse 1.4s ease-in-out infinite;
        }
        @keyframes ui-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.8); }
        }
      `}</style>
    </span>
  );
};
