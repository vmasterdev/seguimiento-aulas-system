import type { ReactNode } from 'react';
import { MainMenu, type MainMenuSection } from './main-menu';

type PageShellProps = {
  active: MainMenuSection;
  title: string;
  description: string;
  children: ReactNode;
};

export function PageShell({ active, title, description, children }: PageShellProps) {
  return (
    <main>
      <MainMenu active={active} />

      <header className="hero">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>

      {children}
    </main>
  );
}

export function SinglePanelPageShell(props: PageShellProps) {
  return (
    <PageShell {...props}>
      <section className="section section-single">{props.children}</section>
    </PageShell>
  );
}
