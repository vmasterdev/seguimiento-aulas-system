'use client';

export type MainMenuSection =
  | 'inicio'
  | 'rpaca'
  | 'docentes'
  | 'review'
  | 'nrc-globales'
  | 'nrc-trazabilidad'
  | 'correos'
  | 'automatizacion-banner'
  | 'automatizacion-moodle';

type MainMenuProps = {
  active: MainMenuSection;
};

const MENU_ITEMS: Array<{ href: string; label: string; section: MainMenuSection }> = [
  { href: '/', label: 'Inicio', section: 'inicio' },
  { href: '/rpaca', label: 'Carga RPACA', section: 'rpaca' },
  { href: '/docentes', label: 'Docentes', section: 'docentes' },
  { href: '/review', label: 'Revision NRC', section: 'review' },
  { href: '/nrc-globales', label: 'NRC Globales', section: 'nrc-globales' },
  { href: '/nrc-trazabilidad', label: 'Trazabilidad NRC', section: 'nrc-trazabilidad' },
  { href: '/correos', label: 'Correos', section: 'correos' },
  { href: '/automatizacion-banner', label: 'Automatizacion Banner', section: 'automatizacion-banner' },
  { href: '/automatizacion-moodle', label: 'Automatizacion Moodle', section: 'automatizacion-moodle' },
];

export function MainMenu({ active }: MainMenuProps) {
  return (
    <nav className="menu-main">
      {MENU_ITEMS.map((item) => (
        <a href={item.href} className={`menu-link${active === item.section ? ' active' : ''}`} key={item.href}>
          {item.label}
        </a>
      ))}
    </nav>
  );
}
