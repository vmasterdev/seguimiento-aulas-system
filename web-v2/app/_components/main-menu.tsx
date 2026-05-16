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
  | 'eventos-significativos'
  | 'design-system';

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

const ICON_BUILDING = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </svg>
);

const ICON_MOON = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
  </svg>
);

const ICON_BAR_CHART = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="12" width="4" height="9" />
    <rect x="10" y="7" width="4" height="14" />
    <rect x="17" y="3" width="4" height="18" />
  </svg>
);

const ICON_CHECK_SQUARE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 11 12 14 22 4" />
    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
  </svg>
);

const ICON_LIST = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6" />
    <line x1="8" y1="12" x2="21" y2="12" />
    <line x1="8" y1="18" x2="21" y2="18" />
    <line x1="3" y1="6" x2="3.01" y2="6" />
    <line x1="3" y1="12" x2="3.01" y2="12" />
    <line x1="3" y1="18" x2="3.01" y2="18" />
  </svg>
);

const ICON_ALERT = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const ICON_HEART = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
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

const ICON_PALETTE = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" />
    <circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" />
    <circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" />
    <circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
    <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-5.52-4.48-9-10-9z" />
  </svg>
);

const IS_DEV = process.env.NODE_ENV === 'development';

type NavItem = {
  href: string;
  label: string;
  section: MainMenuSection;
  icon: React.ReactNode;
  group: 'main' | 'cursos' | 'docentes' | 'operaciones' | 'reportes' | 'system';
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard', section: 'inicio', icon: ICON_HOME, group: 'main' },

  // Cursos
  { href: '/nrc-globales', label: 'NRC Globales', section: 'nrc-globales', icon: ICON_GLOBE, group: 'cursos' },
  { href: '/nrc-prioridad', label: 'Prioridad NRC', section: 'nrc-prioridad', icon: ICON_ALERT, group: 'cursos' },
  { href: '/nrc-trazabilidad', label: 'Trazabilidad', section: 'nrc-trazabilidad', icon: ICON_BRANCH, group: 'cursos' },
  { href: '/review', label: 'Revisión NRC', section: 'review', icon: ICON_CHECK_SQUARE, group: 'cursos' },
  { href: '/aulas-estandar', label: 'Aulas Estándar', section: 'aulas-estandar', icon: ICON_BUILDING, group: 'cursos' },
  { href: '/horarios', label: 'Horarios', section: 'horarios', icon: ICON_CALENDAR, group: 'cursos' },
  { href: '/metricas-uso', label: 'Métricas de Uso', section: 'metricas-uso', icon: ICON_BAR_CHART, group: 'cursos' },

  // Docentes
  { href: '/docentes', label: 'Docentes', section: 'docentes', icon: ICON_USERS, group: 'docentes' },
  { href: '/centros-universitarios', label: 'Centros Universitarios', section: 'centros-universitarios', icon: ICON_BUILDING, group: 'docentes' },
  { href: '/recargos-nocturnos', label: 'Recargos Nocturnos', section: 'recargos-nocturnos', icon: ICON_MOON, group: 'docentes' },

  // Operaciones
  { href: '/rpaca', label: 'Carga RPACA', section: 'rpaca', icon: ICON_UPLOAD, group: 'operaciones' },
  { href: '/automatizacion-banner', label: 'Automatización Banner', section: 'automatizacion-banner', icon: ICON_ZAP, group: 'operaciones' },
  { href: '/automatizacion-moodle', label: 'Moodle Sidecar', section: 'automatizacion-moodle', icon: ICON_SETTINGS, group: 'operaciones' },
  { href: '/analitica-moodle', label: 'Analítica Moodle', section: 'analitica-moodle', icon: ICON_CHART, group: 'operaciones' },
  { href: '/bienestar', label: 'Bienestar', section: 'bienestar', icon: ICON_HEART, group: 'operaciones' },

  // Reportes
  { href: '/correos', label: 'Correos', section: 'correos', icon: ICON_MAIL, group: 'reportes' },
  { href: '/reportes', label: 'Reportes Cierre', section: 'reportes', icon: ICON_REPORT, group: 'reportes' },
  { href: '/eventos-significativos', label: 'Eventos Significativos', section: 'eventos-significativos', icon: ICON_LIST, group: 'reportes' },

  // Sistema (solo en desarrollo)
  ...(IS_DEV ? [{ href: '/design-system', label: 'Design System', section: 'design-system' as MainMenuSection, icon: ICON_PALETTE, group: 'system' as const }] : []),
];

function getActiveSection(pathname: string): MainMenuSection {
  if (pathname === '/') return 'inicio';
  const match = NAV_ITEMS.find((item) => item.href !== '/' && pathname.startsWith(item.href));
  return match?.section ?? 'inicio';
}

function NavGroup({
  label,
  items,
  active,
  onNavigate,
}: {
  label: string;
  items: NavItem[];
  active: MainMenuSection;
  onNavigate?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="sidebar-section-label">{label}</div>
      {items.map((item) => (
        <a
          key={item.href}
          href={item.href}
          className={`sidebar-link${active === item.section ? ' active' : ''}`}
          onClick={onNavigate}
          tabIndex={0}
        >
          {item.icon}
          <span>{item.label}</span>
        </a>
      ))}
    </>
  );
}

function SidebarContent({
  active,
  onNavigate,
}: {
  active: MainMenuSection;
  onNavigate?: () => void;
}) {
  const mainItems = NAV_ITEMS.filter((i) => i.group === 'main');
  const cursosItems = NAV_ITEMS.filter((i) => i.group === 'cursos');
  const docentesItems = NAV_ITEMS.filter((i) => i.group === 'docentes');
  const operacionesItems = NAV_ITEMS.filter((i) => i.group === 'operaciones');
  const reportesItems = NAV_ITEMS.filter((i) => i.group === 'reportes');
  const sysItems = NAV_ITEMS.filter((i) => i.group === 'system');

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
            tabIndex={0}
          >
            {item.icon}
            <span>{item.label}</span>
          </a>
        ))}

        <NavGroup label="Cursos" items={cursosItems} active={active} onNavigate={onNavigate} />
        <NavGroup label="Docentes" items={docentesItems} active={active} onNavigate={onNavigate} />
        <NavGroup label="Operaciones" items={operacionesItems} active={active} onNavigate={onNavigate} />
        <NavGroup label="Reportes" items={reportesItems} active={active} onNavigate={onNavigate} />
        <NavGroup label="Sistema" items={sysItems} active={active} onNavigate={onNavigate} />
      </nav>

      <div className="sidebar-footer">
        Seguimiento Aulas &middot; v5
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
