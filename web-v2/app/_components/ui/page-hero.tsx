'use client';

import type { CSSProperties, ReactNode } from 'react';

type PageHeroProps = {
  title: string;
  description?: string;
  children?: ReactNode; // Right side slot (status pills, actions, etc.)
  style?: CSSProperties;
};

/**
 * PageHero — Banner superior con gradiente premium centralizado en modules.css.
 * Uso: <PageHero title="Título" description="Descripción">
 *        <StatusPill tone="ok">Activo</StatusPill>
 *      </PageHero>
 */
export function PageHero({ title, description, children, style }: PageHeroProps) {
  return (
    <div className="hero-banner" style={style}>
      <div>
        <h1>{title}</h1>
        {description ? <p className="hero-desc">{description}</p> : null}
      </div>
      {children ? <div className="hero-status-area">{children}</div> : null}
    </div>
  );
}
