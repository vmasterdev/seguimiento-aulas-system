'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export type MainMenuSection =
  | 'inicio'
  | 'rpaca'
  | 'docentes'
  | 'banner-docentes'
  | 'centros-universitarios'
  | 'aulas-estandar'
  | 'horarios'
  | 'recargos-nocturnos'
  | 'metricas-uso'
  | 'review'
  | 'nrc-prioridad'
  | 'nrc-globales'
  | 'nrc-trazabilidad'
  | 'correos'
  | 'bienestar'
  | 'automatizacion-banner'
  | 'automatizacion-moodle'
  | 'analitica-moodle'
  | 'reportes'
  | 'eventos-significativos';

const ICON_HOME = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
);

const ICON_UPLOAD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const ICON_USERS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4-4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 00-3-3.87" />
    <path d="M16 3.13a4 4 0 010 7.75" />
  </svg>
);

const ICON_USER_SEARCH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="7" r="4" />
    <path d="M3 21v-2a4 4 0 014-4h4a4 4 0 014 4v2" />
    <circle cx="19" cy="11" r="3" />
    <line x1="21.5" y1="13.5" x2="23" y2="15" />
  </svg>
);

const ICON_CLIPBOARD = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    <path d="M9 14l2 2 4-4" />
  </svg>
);

const ICON_GLOBE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
  </svg>
);

const ICON_BRANCH = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 01-9 9" />
  </svg>
);

const ICON_MAIL = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <polyline points="22,6 12,13 2,6" />
  </svg>
);

const ICON_ZAP = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
);

const ICON_SETTINGS = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const ICON_CHART = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 3v18h18" />
    <path d="M7 15l4-4 3 3 5-7" />
    <circle cx="7" cy="15" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="11" cy="11" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="14" cy="14" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="7" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

const ICON_REPORT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const ICON_CALENDAR = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <circle cx="12" cy="16" r="2" fill="currentColor" stroke="none" />
  </svg>
);

type NavItem = {
  href: string;
  label: string;
  section: MainMenuSection;
  icon: React.ReactNode;
  group: 'main' | 'data' | 'automation';
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', section: 'inicio', icon: ICON_HOME, group: 'main' },
  { href: '/rpaca', label: 'Carga RPACA', section: 'rpaca', icon: ICON_UPLOAD, group: 'data' },
  { href: '/docentes', label: 'Docentes', section: 'docentes', icon: ICON_USERS, group: 'data' },
  { href: '/banner-docentes', label: 'Docentes Banner', section: 'banner-docentes', icon: ICON_USER_SEARCH, group: 'data' },
  { href: '/centros-universitarios', label: 'Centros Universitarios', section: 'centros-universitarios', icon: ICON_USERS, group: 'data' },
  { href: '/horarios', label: 'Horarios', section: 'horarios', icon: ICON_CALENDAR, group: 'data' },
  { href: '/aulas-estandar', label: 'Aulas estandar', section: 'aulas-estandar', icon: ICON_CLIPBOARD, group: 'data' },
  { href: '/recargos-nocturnos', label: 'Recargos nocturnos', section: 'recargos-nocturnos', icon: ICON_REPORT, group: 'data' },
  { href: '/metricas-uso', label: 'Metricas de uso', section: 'metricas-uso', icon: ICON_REPORT, group: 'data' },
  { href: '/review', label: 'Revision NRC', section: 'review', icon: ICON_CLIPBOARD, group: 'data' },
  { href: '/nrc-prioridad', label: 'Prioridad NRC', section: 'nrc-prioridad', icon: ICON_CALENDAR, group: 'data' },
  { href: '/nrc-globales', label: 'NRC Globales', section: 'nrc-globales', icon: ICON_GLOBE, group: 'data' },
  { href: '/nrc-trazabilidad', label: 'Trazabilidad', section: 'nrc-trazabilidad', icon: ICON_BRANCH, group: 'data' },
  { href: '/correos', label: 'Correos', section: 'correos', icon: ICON_MAIL, group: 'data' },
  { href: '/bienestar', label: 'Bienestar', section: 'bienestar', icon: ICON_USERS, group: 'data' },
  { href: '/reportes', label: 'Reportes Cierre', section: 'reportes', icon: ICON_REPORT, group: 'data' },
  { href: '/eventos-significativos', label: 'Eventos Significativos', section: 'eventos-significativos', icon: ICON_REPORT, group: 'data' },
  { href: '/analitica-moodle', label: 'Analitica Moodle', section: 'analitica-moodle', icon: ICON_CHART, group: 'data' },
  { href: '/automatizacion-banner', label: 'Banner', section: 'automatizacion-banner', icon: ICON_ZAP, group: 'automation' },
  { href: '/automatizacion-moodle', label: 'Moodle Sidecar', section: 'automatizacion-moodle', icon: ICON_SETTINGS, group: 'automation' },
];

function getActiveSection(pathname: string): MainMenuSection {
  if (pathname === '/') return 'inicio';
  const match = NAV_ITEMS.find((item) => item.href !== '/' && pathname.startsWith(item.href));
  return match?.section ?? 'inicio';
}

function SidebarContent({
  active,
  onNavigate,
}: {
  active: MainMenuSection;
  onNavigate?: () => void;
}) {
  const mainItems = NAV_ITEMS.filter((i) => i.group === 'main');
  const dataItems = NAV_ITEMS.filter((i) => i.group === 'data');
  const autoItems = NAV_ITEMS.filter((i) => i.group === 'automation');

  return (
    <>
      <div className="sidebar-brand">
        <h2>Seguimiento Aulas</h2>
        <small>UNIMINUTO &middot; Ops Console</small>
      </div>

      <nav className="sidebar-nav">
        {mainItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`sidebar-link${active === item.section ? ' active' : ''}`}
            onClick={onNavigate}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}

        <div className="sidebar-section-label">Datos</div>
        {dataItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`sidebar-link${active === item.section ? ' active' : ''}`}
            onClick={onNavigate}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}

        <div className="sidebar-section-label">Automatizacion</div>
        {autoItems.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className={`sidebar-link${active === item.section ? ' active' : ''}`}
            onClick={onNavigate}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}
      </nav>

      <div className="sidebar-footer">
        Seguimiento Aulas &middot; v4
      </div>
    </>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const active = getActiveSection(pathname);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <>
      <header className="mobile-topbar">
        <a href="/" className="mobile-brand">
          <strong>Seguimiento Aulas</strong>
          <small>Ops Console</small>
        </a>

        <button
          type="button"
          className={`mobile-menu-button${mobileOpen ? ' active' : ''}`}
          aria-label={mobileOpen ? 'Cerrar navegacion' : 'Abrir navegacion'}
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((current) => !current)}
        >
          <span />
          <span />
          <span />
        </button>
      </header>

      <button
        type="button"
        className={`mobile-backdrop${mobileOpen ? ' active' : ''}`}
        aria-label="Cerrar navegacion"
        onClick={() => setMobileOpen(false)}
      />

      <aside className={`sidebar${mobileOpen ? ' mobile-open' : ''}`}>
        <SidebarContent active={active} onNavigate={() => setMobileOpen(false)} />
      </aside>
    </>
  );
}

export function MainMenu({ active: _active }: { active: MainMenuSection }) {
  return null;
}
