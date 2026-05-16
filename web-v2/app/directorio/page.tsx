'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Persona, DaySchedule, ServicioArea } from '../_features/directorio/types';
import { SERVICIOS, getTodaySchedule, getTurnLabel } from '../_features/directorio/types';

type DirectorioResponse = {
  ok: boolean;
  personas: Persona[];
  actualizado: string;
};

const DAY_LABELS: Record<string, string> = {
  lunes: 'L',
  martes: 'M',
  miercoles: 'X',
  jueves: 'J',
  viernes: 'V',
};

const STATUS_CONFIG: Record<DaySchedule, { label: string; color: string; bg: string; dot: string }> = {
  presencial: { label: 'Presencial', color: '#065f46', bg: '#ecfdf5', dot: '#10b981' },
  remoto: { label: 'Remoto', color: '#1e40af', bg: '#eff6ff', dot: '#3b82f6' },
  'no-labora': { label: 'No labora', color: '#6b7280', bg: '#f3f4f6', dot: '#9ca3af' },
};

function getInitials(nombres: string, apellidos: string) {
  return `${nombres.charAt(0)}${apellidos.charAt(0)}`.toUpperCase();
}

function HorarioBar({ horario }: { horario: Persona['horario'] }) {
  const days = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'] as const;
  const todayIdx = new Date().getDay();
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {days.map((d, i) => {
        const status = horario[d];
        const cfg = STATUS_CONFIG[status];
        const isToday = todayIdx === i + 1;
        return (
          <div
            key={d}
            title={`${d.charAt(0).toUpperCase() + d.slice(1)}: ${cfg.label}`}
            style={{
              width: 28,
              height: 28,
              borderRadius: 6,
              background: cfg.bg,
              border: isToday ? `2px solid ${cfg.dot}` : '2px solid transparent',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 2,
              boxShadow: isToday ? `0 0 0 2px ${cfg.dot}33` : 'none',
            }}
          >
            <span style={{ fontSize: 9, fontWeight: 700, color: cfg.color, lineHeight: 1 }}>{DAY_LABELS[d]}</span>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: cfg.dot,
                display: 'block',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function PersonaCard({ persona }: { persona: Persona }) {
  const todayStatus = getTodaySchedule(persona.horario);
  const cfg = STATUS_CONFIG[todayStatus];
  const initials = getInitials(persona.nombres, persona.apellidos);
  const areaColor = AREA_COLORS[persona.area] ?? { bg: '#f3f4f6', text: '#374151' };

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 12,
        boxShadow: '0 2px 8px rgba(27,58,107,0.08)',
        padding: '20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        border: '1px solid #dce3ef',
        transition: 'box-shadow 0.15s',
      }}
    >
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #1b3a6b, #4a72aa)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontWeight: 700,
            fontSize: 17,
            flexShrink: 0,
            letterSpacing: 0.5,
          }}
        >
          {initials}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#111827', lineHeight: 1.3 }}>
            {persona.nombres} {persona.apellidos}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2, lineHeight: 1.3 }}>
            {persona.cargo}
          </div>
          <div
            style={{
              display: 'inline-block',
              marginTop: 6,
              padding: '2px 8px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              background: areaColor.bg,
              color: areaColor.text,
            }}
          >
            {persona.area}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <HorarioBar horario={persona.horario} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            borderRadius: 20,
            background: cfg.bg,
            fontSize: 12,
            fontWeight: 600,
            color: cfg.color,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
          Hoy: {cfg.label}
          {todayStatus !== 'no-labora' && (
            <span style={{ fontWeight: 400, color: cfg.color, opacity: 0.8 }}>· {getTurnLabel(persona.horario.turno)}</span>
          )}
        </div>
      </div>

      {persona.tramites.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {persona.tramites.slice(0, 4).map((t) => (
            <span
              key={t}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 20,
                background: '#eef2f7',
                color: '#374151',
                border: '1px solid #dce3ef',
              }}
            >
              {t}
            </span>
          ))}
          {persona.tramites.length > 4 && (
            <span style={{ fontSize: 11, padding: '2px 8px', color: '#6b7280' }}>
              +{persona.tramites.length - 4} más
            </span>
          )}
        </div>
      )}

      {persona.notas && (
        <div
          style={{
            fontSize: 12,
            color: '#b8841a',
            background: '#fef5e4',
            borderRadius: 6,
            padding: '6px 10px',
            borderLeft: '3px solid #b8841a',
          }}
        >
          {persona.notas}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {persona.contactoTeams && !persona.esLiderazgo && (
          <a
            href={`https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(persona.contactoTeams)}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              background: '#1b3a6b',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
          >
            <TeamsIcon />
            Escribir por Teams
          </a>
        )}
        {persona.esLiderazgo && (
          <a
            href={
              persona.enlaceAgenda
                ? persona.enlaceAgenda
                : `mailto:${persona.email}?subject=Solicitud%20de%20cita&body=Buenos%20días%2C%20quisiera%20agendar%20una%20cita%20con%20usted.`
            }
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              background: '#b8841a',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <CalendarIcon />
            Agendar cita
          </a>
        )}
        {persona.email && (
          <a
            href={`mailto:${persona.email}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 12px',
              borderRadius: 8,
              background: '#eef2f7',
              color: '#374151',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              border: '1px solid #dce3ef',
            }}
          >
            <MailIcon />
            Correo
          </a>
        )}
      </div>
    </div>
  );
}

function ServicioCard({ servicio, onSearch }: { servicio: ServicioArea; onSearch: (q: string) => void }) {
  const areaColor = AREA_COLORS[servicio.area] ?? { bg: '#f3f4f6', text: '#374151' };
  const badge = servicio.tipoContacto === 'agendado'
    ? { label: 'Con cita previa', color: '#b8841a', bg: '#fef5e4' }
    : { label: 'Atención directa', color: '#065f46', bg: '#ecfdf5' };

  return (
    <button
      onClick={() => onSearch(servicio.nombre)}
      style={{
        background: '#fff',
        borderRadius: 10,
        padding: '16px',
        border: '1px solid #dce3ef',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'box-shadow 0.15s, border-color 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = '0 4px 16px rgba(27,58,107,0.12)';
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#4a72aa';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.boxShadow = 'none';
        (e.currentTarget as HTMLButtonElement).style.borderColor = '#dce3ef';
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14, color: '#111827' }}>{servicio.nombre}</div>
      <div style={{ fontSize: 12, color: '#6b7280', lineHeight: 1.5 }}>{servicio.descripcion}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 20,
            background: areaColor.bg,
            color: areaColor.text,
            fontWeight: 600,
          }}
        >
          {servicio.area}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 20,
            background: badge.bg,
            color: badge.color,
            fontWeight: 500,
          }}
        >
          {badge.label}
        </span>
      </div>
    </button>
  );
}

const AREA_COLORS: Record<string, { bg: string; text: string }> = {
  'Registro y Control Académico': { bg: '#e8edf7', text: '#1b3a6b' },
  'Financiera': { bg: '#fef3c7', text: '#92400e' },
  'Bienestar Universitario': { bg: '#ecfdf5', text: '#065f46' },
  'Coordinación Académica': { bg: '#eff6ff', text: '#1e40af' },
  'Dirección': { bg: '#f5f3ff', text: '#5b21b6' },
  'TICs': { bg: '#fdf2f8', text: '#9d174d' },
  'Biblioteca': { bg: '#fff7ed', text: '#9a3412' },
};

function normalize(str: string) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function TeamsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.5 8.5A2.5 2.5 0 0017 6a2.5 2.5 0 00-2.5 2.5c0 .47.13.91.36 1.28L13 11.5H9.5A1.5 1.5 0 008 13v5a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0018 18v-5c0-.52-.27-.97-.68-1.24.11-.37.18-.75.18-1.26zM17 7a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

export default function DirectorioPage() {
  const [query, setQuery] = useState('');
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [loading, setLoading] = useState(true);
  const [areaFilter, setAreaFilter] = useState<string | null>(null);

  useEffect(() => {
    void fetch('/api/directorio/staff')
      .then((r) => r.json() as Promise<DirectorioResponse>)
      .then((d) => {
        if (d.ok) setPersonas(d.personas.filter((p) => p.visible).sort((a, b) => (a.orden ?? 99) - (b.orden ?? 99)));
      })
      .finally(() => setLoading(false));
  }, []);

  const areas = useMemo(() => {
    const set = new Set(personas.map((p) => p.area));
    return Array.from(set).sort();
  }, [personas]);

  const q = normalize(query);

  const matchedServicios = useMemo(() => {
    if (!q) return [];
    return SERVICIOS.filter((s) => {
      const text = normalize(s.nombre + ' ' + s.descripcion + ' ' + s.keywords.join(' ') + ' ' + s.area);
      return text.includes(q);
    });
  }, [q]);

  const matchedPersonas = useMemo(() => {
    let list = personas;
    if (areaFilter) list = list.filter((p) => p.area === areaFilter);
    if (!q) return list;
    return list.filter((p) => {
      const text = normalize(
        [p.nombres, p.apellidos, p.cargo, p.area, ...p.tramites].join(' '),
      );
      return text.includes(q);
    });
  }, [q, personas, areaFilter]);

  const showingAll = !q && !areaFilter;

  return (
    <div style={{ minHeight: '100vh', background: '#eef2f7' }}>
      {/* Header */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 60%, #1e40af 100%)',
          padding: '40px 24px 48px',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 680, margin: '0 auto' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 20,
              padding: '4px 14px',
              marginBottom: 16,
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd', letterSpacing: 1, textTransform: 'uppercase' }}>
              UNIMINUTO · Centro de Referencia
            </span>
          </div>
          <h1
            style={{
              fontSize: 'clamp(24px, 5vw, 36px)',
              fontWeight: 800,
              color: '#fff',
              margin: '0 0 10px',
              lineHeight: 1.2,
            }}
          >
            Directorio de Personal
          </h1>
          <p style={{ fontSize: 15, color: '#bfdbfe', margin: '0 0 28px', lineHeight: 1.6 }}>
            Encuentra la persona o el servicio que necesitas. Consulta su disponibilidad y comunícate directamente.
          </p>

          {/* Search */}
          <div style={{ position: 'relative', maxWidth: 520, margin: '0 auto' }}>
            <div
              style={{
                position: 'absolute',
                left: 16,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#6b7280',
                pointerEvents: 'none',
              }}
            >
              <SearchIcon />
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setAreaFilter(null);
              }}
              placeholder="¿Qué necesitas? Ej: certificado, matrícula, beca..."
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '14px 16px 14px 48px',
                borderRadius: 12,
                border: 'none',
                fontSize: 15,
                background: '#fff',
                color: '#111827',
                boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
                outline: 'none',
              }}
              autoFocus
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px 64px' }}>

        {/* Leyenda */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 28,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>Disponibilidad:</span>
          {(['presencial', 'remoto', 'no-labora'] as DaySchedule[]).map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: cfg.color }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot, display: 'inline-block' }} />
                {cfg.label}
              </span>
            );
          })}
          <span style={{ fontSize: 12, color: '#9ca3af', marginLeft: 'auto' }}>
            El cuadro con borde resaltado indica el día de hoy
          </span>
        </div>

        {/* Servicios encontrados */}
        {matchedServicios.length > 0 && (
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 14 }}>
              Servicios relacionados
            </h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                gap: 12,
              }}
            >
              {matchedServicios.map((s) => (
                <ServicioCard key={s.id} servicio={s} onSearch={(q) => setQuery(q)} />
              ))}
            </div>
          </div>
        )}

        {/* Si no hay búsqueda: mostrar catálogo de servicios */}
        {showingAll && (
          <div style={{ marginBottom: 36 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 6 }}>
              ¿No sabes qué necesitas? Busca por tipo de trámite
            </h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 14 }}>
              Haz clic en cualquier servicio para ver el personal que puede ayudarte.
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                gap: 10,
              }}
            >
              {SERVICIOS.map((s) => (
                <ServicioCard key={s.id} servicio={s} onSearch={(q) => setQuery(q)} />
              ))}
            </div>
          </div>
        )}

        {/* Filtro por área */}
        {!q && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
            <button
              onClick={() => setAreaFilter(null)}
              style={{
                padding: '6px 14px',
                borderRadius: 20,
                border: '1px solid',
                borderColor: !areaFilter ? '#1b3a6b' : '#dce3ef',
                background: !areaFilter ? '#1b3a6b' : '#fff',
                color: !areaFilter ? '#fff' : '#374151',
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              Todos
            </button>
            {areas.map((area) => {
              const ac = AREA_COLORS[area];
              const active = areaFilter === area;
              return (
                <button
                  key={area}
                  onClick={() => setAreaFilter(active ? null : area)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: 20,
                    border: '1px solid',
                    borderColor: active ? (ac?.text ?? '#1b3a6b') : '#dce3ef',
                    background: active ? (ac?.bg ?? '#e8edf7') : '#fff',
                    color: active ? (ac?.text ?? '#1b3a6b') : '#374151',
                    fontSize: 13,
                    fontWeight: active ? 600 : 400,
                    cursor: 'pointer',
                  }}
                >
                  {area}
                </button>
              );
            })}
          </div>
        )}

        {/* Personas */}
        <div style={{ marginTop: q ? 24 : 0 }}>
          {q && matchedPersonas.length > 0 && (
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 14 }}>
              Personal que puede ayudarte
            </h2>
          )}
          {!q && (
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111827', marginBottom: 14 }}>
              {areaFilter ? areaFilter : 'Todo el personal'}
              <span style={{ fontWeight: 400, color: '#6b7280', fontSize: 13, marginLeft: 8 }}>
                ({matchedPersonas.length} {matchedPersonas.length === 1 ? 'persona' : 'personas'})
              </span>
            </h2>
          )}

          {loading ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 }}>
              Cargando directorio...
            </div>
          ) : matchedPersonas.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '40px 0',
                color: '#6b7280',
                fontSize: 14,
              }}
            >
              {q ? (
                <>
                  No se encontraron resultados para <strong>&quot;{query}&quot;</strong>.
                  <br />
                  <button
                    onClick={() => setQuery('')}
                    style={{
                      marginTop: 12,
                      padding: '8px 16px',
                      borderRadius: 8,
                      background: '#1b3a6b',
                      color: '#fff',
                      border: 'none',
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    Ver todo el directorio
                  </button>
                </>
              ) : (
                'No hay personal registrado en esta área.'
              )}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
                gap: 16,
              }}
            >
              {matchedPersonas.map((p) => (
                <PersonaCard key={p.id} persona={p} />
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            marginTop: 48,
            textAlign: 'center',
            fontSize: 12,
            color: '#9ca3af',
            borderTop: '1px solid #dce3ef',
            paddingTop: 24,
          }}
        >
          Directorio actualizado periódicamente · Para actualizar información contacta al área de TICs
        </div>
      </div>
    </div>
  );
}
