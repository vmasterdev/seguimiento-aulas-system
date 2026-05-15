import type { ReactNode } from 'react';
import type { MainMenuSection } from './main-menu';
import { PageHero } from './ui/page-hero';

type PageShellProps = {
  active: MainMenuSection;
  title: string;
  description: string;
  children: ReactNode;
  hideHeader?: boolean;
};

export function PageShell({ title, description, children, hideHeader = true }: PageShellProps) {
  return (
    <div className="shell">
      {!hideHeader && (
        <PageHero title={title} description={description} />
      )}
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
