'use client';

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', icon, loading, children, disabled, style, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`ui-btn btn-${variant} btn-${size} ${className}`.trim()}
        style={style}
        {...props}
      >
        <style jsx>{`
          .ui-btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            font-weight: 600;
            border-radius: 10px;
            transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1);
            cursor: pointer;
            border: 1px solid transparent;
            user-select: none;
            white-space: nowrap;
            letter-spacing: -0.01em;
          }

          .ui-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
            transform: none !important;
          }

          .ui-btn:active:not(:disabled) {
            transform: scale(0.97);
          }

          .ui-btn:focus-visible {
            outline: 2px solid var(--primary);
            outline-offset: 2px;
          }
          .btn-danger:focus-visible {
            outline-color: var(--red-darker);
          }

          /* Variants */
          .btn-primary {
            background: linear-gradient(135deg, var(--primary) 0%, var(--blue-800) 100%);
            color: var(--text-inverse);
            box-shadow: 0 4px 12px var(--primary-focus-ring);
          }
          .btn-primary:hover:not(:disabled) {
            background: linear-gradient(135deg, var(--hero-mid) 0%, var(--blue-800) 100%);
            box-shadow: 0 6px 16px rgba(27, 58, 107, 0.2);
          }

          .btn-secondary {
            background: var(--surface);
            color: var(--primary);
            border-color: var(--line);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.04);
          }
          .btn-secondary:hover:not(:disabled) {
            background: var(--footer-bg);
            border-color: var(--line-hover);
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.06);
          }

          .btn-danger {
            background: var(--red-light);
            color: var(--red-darker);
            border-color: var(--red-100);
          }
          .btn-danger:hover:not(:disabled) {
            background: var(--red-darker);
            color: var(--text-inverse);
            border-color: var(--red-darker);
            box-shadow: 0 4px 12px rgba(220, 38, 38, 0.15);
          }

          .btn-ghost {
            background: transparent;
            color: var(--text-muted-2);
          }
          .btn-ghost:hover:not(:disabled) {
            background: rgba(15, 23, 42, 0.05);
            color: var(--n-800);
          }

          /* Sizes */
          .btn-sm {
            padding: 6px 12px;
            font-size: 0.78rem;
            border-radius: 8px;
          }
          .btn-md {
            padding: 10px 18px;
            font-size: 0.85rem;
          }
          .btn-lg {
            padding: 14px 24px;
            font-size: 0.95rem;
          }

          @keyframes ui-spin {
            to { transform: rotate(360deg); }
          }
          .spinner {
            width: 14px;
            height: 14px;
            border: 2px solid currentColor;
            border-top-color: transparent;
            borderRadius: 999px;
            animation: ui-spin 800ms linear infinite;
            display: inline-block;
            flex-shrink: 0;
          }
        `}</style>
        {loading ? (
          <span className="spinner" />
        ) : icon ? (
          <span style={{ display: 'inline-flex', flexShrink: 0 }}>{icon}</span>
        ) : null}
        {children}
      </button>
    );
  },
);

Button.displayName = 'Button';
