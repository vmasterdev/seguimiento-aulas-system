import type { ReactNode } from 'react';
import type { MainMenuSection } from './main-menu';

type PageShellProps = {
  active: MainMenuSection;
  title: string;
  description: string;
  children: ReactNode;
};

export function PageShell({ title, description, children }: PageShellProps) {
  return (
    <div className="shell">
      <header className="page-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}

export function SinglePanelPageShell(props: PageShellProps) {
  return (
    <PageShell {...props}>
      <section className="section section-single">{props.children}</section>
    </PageShell>
  );
}
