'use client';

import { useState } from 'react';
import { Button, AlertBox, useConfirm, PaginationControls } from '../../_components/ui';
import { useFetch } from '../../_lib/use-fetch';
import type { Persona, HorarioSemanal, DaySchedule, Turno } from './types';
import { HORARIO_VACIO, getTodaySchedule } from './types';
import type { PageSizeOption } from '../../_components/ui';

type ListResult = {
  ok: boolean;
  personas: Persona[];
  actualizado: string;
};

const EMPTY_FORM: Omit<Persona, 'id'> & { id: string } = {
  id: '',
  nombres: '',
  apellidos: '',
  cargo: '',
  area: '',
  email: '',
  contactoTeams: '',
  telefono: '',
  horario: { ...HORARIO_VACIO },
  tramites: [],
  esLiderazgo: false,
  enlaceAgenda: '',
  visible: true,
  campusCode: '',
  notas: '',
  orden: undefined,
};

const DAY_LABELS: Array<{ key: keyof HorarioSemanal; label: string }> = [
  { key: 'lunes', label: 'Lun' },
  { key: 'martes', label: 'Mar' },
  { key: 'miercoles', label: 'Mié' },
  { key: 'jueves', label: 'Jue' },
  { key: 'viernes', label: 'Vie' },
];

const STATUS_OPTIONS: DaySchedule[] = ['presencial', 'remoto', 'no-labora'];
const STATUS_LABELS: Record<DaySchedule, string> = {
  presencial: 'Presencial',
  remoto: 'Remoto',
  'no-labora': 'No labora',
};
const STATUS_COLORS: Record<DaySchedule, string> = {
  presencial: '#065f46',
  remoto: '#1e40af',
  'no-labora': '#9ca3af',
};
const STATUS_BG: Record<DaySchedule, string> = {
  presencial: '#ecfdf5',
  remoto: '#eff6ff',
  'no-labora': '#f3f4f6',
};

export function DirectorioPanel({ apiBase }: { apiBase: string }) {
  const confirm = useConfirm();
  const [form, setForm] = useState(EMPTY_FORM);
  const [tramitesInput, setTramitesInput] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSizeOption>(50);

  const { data, loading, error, refresh } = useFetch<ListResult>(`${apiBase}/directorio/staff`);

  const allPersonas = data?.personas ?? [];
  const total = allPersonas.length;
  const start = (page - 1) * pageSize;
  const personas = allPersonas.slice(start, start + pageSize);

  function openNew() {
    setForm({ ...EMPTY_FORM, horario: { ...HORARIO_VACIO } });
    setTramitesInput('');
    setMessage('');
    setFormOpen(true);
  }

  function openEdit(p: Persona) {
    setForm({ ...p });
    setTramitesInput(p.tramites.join(', '));
    setMessage('');
    setFormOpen(true);
  }

  function setDay(day: keyof HorarioSemanal, value: DaySchedule) {
    setForm((prev) => ({
      ...prev,
      horario: { ...prev.horario, [day]: value },
    }));
  }

  function setTurno(turno: Turno) {
    setForm((prev) => ({
      ...prev,
      horario: { ...prev.horario, turno },
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nombres.trim() || !form.apellidos.trim() || !form.cargo.trim() || !form.area.trim()) {
      setMessage('Completa: nombres, apellidos, cargo y área.');
      return;
    }
    setSaving(true);
    setMessage('');
    try {
      const tramites = tramitesInput
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const r = await fetch(`${apiBase}/directorio/staff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, tramites }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!r.ok || !j.ok) {
        setMessage(`Error: ${j.error ?? 'desconocido'}`);
        return;
      }
      setFormOpen(false);
      void refresh();
    } finally {
      setSaving(false);
    }
  }

  async function remove(p: Persona) {
    const ok = await confirm({
      title: 'Eliminar persona',
      message: `¿Eliminar a ${p.nombres} ${p.apellidos} del directorio?`,
      confirmLabel: 'Eliminar',
      tone: 'danger',
    });
    if (!ok) return;
    await fetch(`${apiBase}/directorio/staff?id=${p.id}`, { method: 'DELETE' });
    void refresh();
  }

  async function toggleVisibility(p: Persona) {
    await fetch(`${apiBase}/directorio/staff`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...p, visible: !p.visible }),
    });
    void refresh();
  }

  const todayStatus = (p: Persona) => getTodaySchedule(p.horario);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {total} {total === 1 ? 'persona registrada' : 'personas registradas'}
            {data?.actualizado && ` · Actualizado ${data.actualizado}`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href="/directorio"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 8,
              background: '#eef2f7',
              color: '#1b3a6b',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              border: '1px solid #dce3ef',
            }}
          >
            Ver directorio público
          </a>
          <Button variant="primary" size="sm" onClick={openNew}>
            + Agregar persona
          </Button>
        </div>
      </div>

      {error && <AlertBox tone="error" message={error} />}

      {/* Form modal */}
      {formOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={(e) => { if (e.target === e.currentTarget) setFormOpen(false); }}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              width: '100%',
              maxWidth: 600,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}
          >
            <h3 style={{ margin: '0 0 20px', fontSize: 16, fontWeight: 700, color: '#111827' }}>
              {form.id ? 'Editar persona' : 'Agregar persona'}
            </h3>

            <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <FormField label="Nombres *" value={form.nombres} onChange={(v) => setForm((p) => ({ ...p, nombres: v }))} />
                <FormField label="Apellidos *" value={form.apellidos} onChange={(v) => setForm((p) => ({ ...p, apellidos: v }))} />
              </div>
              <FormField label="Cargo *" value={form.cargo} onChange={(v) => setForm((p) => ({ ...p, cargo: v }))} placeholder="Ej: Auxiliar de Registro Académico" />
              <FormField label="Área *" value={form.area} onChange={(v) => setForm((p) => ({ ...p, area: v }))} placeholder="Ej: Registro y Control Académico" />
              <FormField label="Correo electrónico" value={form.email} onChange={(v) => setForm((p) => ({ ...p, email: v }))} type="email" />
              <FormField label="Usuario Teams (email)" value={form.contactoTeams ?? ''} onChange={(v) => setForm((p) => ({ ...p, contactoTeams: v }))} placeholder="usuario@uniminuto.edu.co" />
              <FormField label="Teléfono (opcional)" value={form.telefono ?? ''} onChange={(v) => setForm((p) => ({ ...p, telefono: v }))} />

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
                  Horario semanal
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                  {DAY_LABELS.map(({ key, label }) => {
                    if (key === 'turno') return null;
                    const val = form.horario[key as keyof HorarioSemanal] as DaySchedule;
                    return (
                      <div key={key} style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', marginBottom: 4 }}>{label}</div>
                        <select
                          value={val}
                          onChange={(e) => setDay(key as keyof HorarioSemanal, e.target.value as DaySchedule)}
                          style={{
                            padding: '4px 6px',
                            borderRadius: 6,
                            border: '1px solid #dce3ef',
                            fontSize: 12,
                            background: STATUS_BG[val],
                            color: STATUS_COLORS[val],
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          {STATUS_OPTIONS.map((s) => (
                            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                          ))}
                        </select>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 12, color: '#374151', fontWeight: 500 }}>Turno:</label>
                  {(['mañana', 'tarde', 'completo'] as Turno[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTurno(t)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: 20,
                        border: '1px solid',
                        borderColor: form.horario.turno === t ? '#1b3a6b' : '#dce3ef',
                        background: form.horario.turno === t ? '#1b3a6b' : '#fff',
                        color: form.horario.turno === t ? '#fff' : '#374151',
                        fontSize: 12,
                        cursor: 'pointer',
                        fontWeight: 500,
                        textTransform: 'capitalize',
                      }}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <FormField
                label="Trámites que atiende (separados por coma)"
                value={tramitesInput}
                onChange={setTramitesInput}
                placeholder="Ej: matricula, certificados, homologacion"
              />

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.esLiderazgo}
                    onChange={(e) => setForm((p) => ({ ...p, esLiderazgo: e.target.checked }))}
                  />
                  Cargo de liderazgo (coordinación/dirección) — requiere cita previa
                </label>
              </div>

              {form.esLiderazgo && (
                <FormField
                  label="Enlace para agendar cita (opcional)"
                  value={form.enlaceAgenda ?? ''}
                  onChange={(v) => setForm((p) => ({ ...p, enlaceAgenda: v }))}
                  placeholder="URL de Calendly, Teams, etc."
                />
              )}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={form.visible}
                    onChange={(e) => setForm((p) => ({ ...p, visible: e.target.checked }))}
                  />
                  Visible en el directorio público
                </label>
              </div>

              <FormField
                label="Notas para el estudiante (opcional)"
                value={form.notas ?? ''}
                onChange={(v) => setForm((p) => ({ ...p, notas: v }))}
                placeholder="Ej: Para atención virtual: comunicarse primero por Teams"
              />

              {message && <AlertBox tone="error" message={message} />}

              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                <Button variant="secondary" size="sm" type="button" onClick={() => setFormOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" disabled={saving}>
                  {saving ? 'Guardando...' : form.id ? 'Guardar cambios' : 'Agregar'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>Cargando...</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #dce3ef' }}>
                <Th>Persona</Th>
                <Th>Cargo / Área</Th>
                <Th>Hoy</Th>
                <Th>Semana</Th>
                <Th>Liderazgo</Th>
                <Th>Visible</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {personas.map((p) => {
                const ts = todayStatus(p);
                return (
                  <tr key={p.id} style={{ borderBottom: '1px solid #eef1f7' }}>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ fontWeight: 600, color: '#111827' }}>{p.nombres} {p.apellidos}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{p.email}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ color: '#374151' }}>{p.cargo}</div>
                      <div style={{ fontSize: 12, color: '#6b7280' }}>{p.area}</div>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 12,
                          fontSize: 11,
                          fontWeight: 600,
                          background: STATUS_BG[ts],
                          color: STATUS_COLORS[ts],
                        }}
                      >
                        {STATUS_LABELS[ts]}
                      </span>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {DAY_LABELS.map(({ key, label }) => {
                          if (key === 'turno') return null;
                          const val = p.horario[key as keyof HorarioSemanal] as DaySchedule;
                          return (
                            <span
                              key={key}
                              title={`${label}: ${STATUS_LABELS[val]}`}
                              style={{
                                width: 20,
                                height: 20,
                                borderRadius: 4,
                                background: STATUS_BG[val],
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 9,
                                fontWeight: 700,
                                color: STATUS_COLORS[val],
                              }}
                            >
                              {label[0]}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      {p.esLiderazgo ? (
                        <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 10, background: '#f5f3ff', color: '#5b21b6', fontWeight: 600 }}>
                          Sí
                        </span>
                      ) : (
                        <span style={{ fontSize: 11, color: '#9ca3af' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => void toggleVisibility(p)}
                        title={p.visible ? 'Ocultar del directorio' : 'Mostrar en el directorio'}
                        style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 600,
                          border: '1px solid',
                          cursor: 'pointer',
                          borderColor: p.visible ? '#10b981' : '#dce3ef',
                          background: p.visible ? '#ecfdf5' : '#f9fafb',
                          color: p.visible ? '#065f46' : '#9ca3af',
                        }}
                      >
                        {p.visible ? 'Visible' : 'Oculto'}
                      </button>
                    </td>
                    <td style={{ padding: '10px 8px' }}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <Button variant="secondary" size="sm" onClick={() => openEdit(p)}>Editar</Button>
                        <Button variant="danger" size="sm" onClick={() => void remove(p)}>Eliminar</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {personas.length === 0 && !loading && (
                <tr>
                  <td colSpan={7} style={{ padding: '24px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>
                    No hay personas en el directorio. Agrega la primera.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {total > pageSize && (
        <PaginationControls
          currentPage={page}
          totalPages={Math.ceil(total / pageSize)}
          totalItems={total}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPage(1); setPageSize(s); }}
          label="personas"
        />
      )}
    </>
  );
}

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          padding: '8px 10px',
          borderRadius: 6,
          border: '1px solid #dce3ef',
          fontSize: 13,
          color: '#111827',
          background: '#fff',
          outline: 'none',
        }}
      />
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '8px 8px',
        textAlign: 'left',
        fontSize: 11,
        fontWeight: 700,
        color: '#6b7280',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </th>
  );
}
