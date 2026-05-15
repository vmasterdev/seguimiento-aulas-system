'use client';

import { useState } from 'react';
import { Button, Field, StatusPill, AlertBox, StatsGrid, FilterBar, VirtualTable, Modal, useToast, useConfirm } from '../../_components/ui';
import type { VirtualTableColumn } from '../../_components/ui';

/**
 * Design System Showcase
 *
 * Página de referencia visual para mantener consistencia en todo el sistema.
 * Si necesitas un componente nuevo, primero revisa si existe acá.
 * Si no existe, créalo en _components/ui/ antes de usarlo inline.
 *
 * Ver DESIGN_SYSTEM.md en la raíz del repo para reglas completas.
 */
type DemoRow = { id: string; nrc: string; period: string; teacher: string; banner: 'ok' | 'warn' | 'danger'; grade: string };

const DEMO_ROWS: DemoRow[] = Array.from({ length: 600 }, (_, i) => {
  const tones: DemoRow['banner'][] = ['ok', 'warn', 'danger'];
  return {
    id: `row-${i}`,
    nrc: `15-${72000 + i}`,
    period: '202615',
    teacher: ['Jefferson Díaz', 'Camila Remicio', 'Sandra Hernández', 'Andrés Mora'][i % 4],
    banner: tones[i % 3],
    grade: i % 3 === 1 ? '-' : `A: ${(40 + (i % 12)).toFixed(1)}`,
  };
});

export function DesignSystemShowcase() {
  const [activeSection, setActiveSection] = useState<string>('tokens');
  const [vtExpanded, setVtExpanded] = useState<Set<string>>(new Set());
  const [vtSelected, setVtSelected] = useState<Set<string>>(new Set());
  const [modalOpen, setModalOpen] = useState(false);
  const [modalSm, setModalSm] = useState(false);
  const toast = useToast();
  const confirm = useConfirm();

  const vtColumns: VirtualTableColumn<DemoRow>[] = [
    { key: 'nrc', header: 'NRC', width: '110px', render: (r) => <strong>{r.nrc}</strong> },
    { key: 'period', header: 'Periodo', width: '90px', render: (r) => r.period },
    { key: 'teacher', header: 'Docente', render: (r) => r.teacher },
    {
      key: 'banner',
      header: 'Banner',
      width: '140px',
      render: (r) => (
        <StatusPill tone={r.banner}>
          {r.banner === 'ok' ? 'ENCONTRADO' : r.banner === 'warn' ? 'SIN_DOCENTE' : 'NO_ENCONTRADO'}
        </StatusPill>
      ),
    },
    { key: 'grade', header: 'Calificación', width: '120px', render: (r) => r.grade },
  ];

  const sections = [
    { id: 'tokens', label: 'Tokens' },
    { id: 'typography', label: 'Tipografía' },
    { id: 'buttons', label: 'Botones' },
    { id: 'pills', label: 'StatusPill' },
    { id: 'alerts', label: 'AlertBox' },
    { id: 'fields', label: 'Fields / Forms' },
    { id: 'stats', label: 'StatsGrid' },
    { id: 'tables', label: 'Tablas' },
    { id: 'overlays', label: 'Modales / Toasts' },
    { id: 'patterns', label: 'Patrones' },
  ];

  return (
    <div style={{ display: 'grid', gap: '16px' }}>

      {/* NAV INTERNO */}
      <nav style={{
        display: 'flex',
        gap: 4,
        padding: '8px',
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        flexWrap: 'wrap',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => {
              setActiveSection(s.id);
              document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            style={{
              padding: '6px 12px',
              fontSize: 'var(--fs-sm)',
              fontWeight: activeSection === s.id ? 600 : 500,
              background: activeSection === s.id ? 'var(--primary-muted)' : 'transparent',
              color: activeSection === s.id ? 'var(--primary)' : 'var(--n-600)',
              border: '1px solid transparent',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
            }}
          >
            {s.label}
          </button>
        ))}
      </nav>

      {/* TOKENS */}
      <Section id="tokens" title="Tokens de color">
        <SubSection title="Paleta institucional">
          <ColorGrid colors={[
            { name: '--primary', value: '#1b3a6b', desc: 'Azul naval. Botones primarios, links activos.' },
            { name: '--primary-dark', value: '#122850', desc: 'Hover/active.' },
            { name: '--primary-dim', value: '#4a72aa', desc: 'Variante diluida.' },
            { name: '--primary-light', value: '#e8edf7', desc: 'Fondos sutiles.' },
            { name: '--gold', value: '#b8841a', desc: 'Acento UNIMINUTO. Uso escaso.' },
          ]} />
        </SubSection>

        <SubSection title="Neutrales">
          <ColorGrid colors={[
            { name: '--ink', value: '#111827', desc: 'Texto principal.' },
            { name: '--muted', value: '#6b7280', desc: 'Texto secundario.' },
            { name: '--subtle', value: '#9ca3af', desc: 'Texto deshabilitado.' },
            { name: '--bg', value: '#eef2f7', desc: 'Fondo de app.' },
            { name: '--surface', value: '#ffffff', desc: 'Cards, paneles.' },
            { name: '--line', value: '#dce3ef', desc: 'Bordes principales.' },
            { name: '--line2', value: '#eef1f7', desc: 'Bordes sutiles.' },
          ]} />
        </SubSection>

        <SubSection title="Semánticos">
          <ColorGrid colors={[
            { name: '--green', value: '#10b981', desc: 'OK, éxito.' },
            { name: '--amber', value: '#f59e0b', desc: 'Advertencia.' },
            { name: '--red', value: '#ef4444', desc: 'Error, peligro.' },
            { name: '--blue', value: '#3b82f6', desc: 'Información.' },
          ]} />
        </SubSection>

        <SubSection title="Espacios (4px base)">
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            {[
              { token: '--sp-1', px: 4 },
              { token: '--sp-2', px: 6 },
              { token: '--sp-3', px: 8 },
              { token: '--sp-4', px: 12 },
              { token: '--sp-5', px: 16 },
              { token: '--sp-6', px: 24 },
              { token: '--sp-7', px: 32 },
            ].map((s) => (
              <div key={s.token} style={{ textAlign: 'center' }}>
                <div style={{ width: s.px, height: s.px, background: 'var(--primary)', borderRadius: 2 }} />
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>{s.token}</div>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--subtle)' }}>{s.px}px</div>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="Radios y sombras">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { token: 'radius', radius: 'var(--radius)' },
              { token: 'radius-md', radius: 'var(--radius-md)' },
              { token: 'radius-lg', radius: 'var(--radius-lg)' },
            ].map((r) => (
              <div key={r.token} style={{ textAlign: 'center' }}>
                <div style={{ width: 60, height: 60, background: 'var(--primary-light)', border: '1px solid var(--line)', borderRadius: r.radius }} />
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>--{r.token}</div>
              </div>
            ))}
            {[
              { token: 'shadow-xs', shadow: 'var(--shadow-xs)' },
              { token: 'shadow-sm', shadow: 'var(--shadow-sm)' },
              { token: 'shadow', shadow: 'var(--shadow)' },
              { token: 'shadow-md', shadow: 'var(--shadow-md)' },
            ].map((s) => (
              <div key={s.token} style={{ textAlign: 'center' }}>
                <div style={{ width: 60, height: 60, background: 'var(--surface)', borderRadius: 'var(--radius-md)', boxShadow: s.shadow }} />
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>--{s.token}</div>
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      {/* TIPOGRAFÍA */}
      <Section id="typography" title="Tipografía">
        <SubSection title="Escala (densa operativa)">
          <div style={{ display: 'grid', gap: 8 }}>
            {[
              { token: '--fs-2xl', size: '1.8rem', label: 'HERO NUMBER', sample: '2,847' },
              { token: '--fs-xl', size: '1.4rem', label: 'KPI VALUE', sample: 'Total NRC: 1,234' },
              { token: '--fs-lg', size: '1.1rem', label: 'PAGE TITLE (h2)', sample: 'NRC Globales' },
              { token: '--fs-md', size: '0.95rem', label: 'SECTION TITLE (h3)', sample: 'Detalle de Moodle' },
              { token: '--fs-base', size: '0.85rem', label: 'BODY / FORMS', sample: 'Texto regular del cuerpo.' },
              { token: '--fs-sm', size: '0.78rem', label: 'DATA TABLES', sample: 'Datos en tablas densas.' },
              { token: '--fs-xs', size: '0.72rem', label: 'META', sample: 'Información secundaria.' },
              { token: '--fs-micro', size: '0.68rem', label: 'LABELS UPPERCASE', sample: 'LABEL SMALL' },
            ].map((t) => (
              <div key={t.token} style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 16, alignItems: 'baseline', padding: '6px 0', borderBottom: '1px solid var(--line2)' }}>
                <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                  {t.token} <span style={{ color: 'var(--subtle)' }}>({t.size})</span>
                </div>
                <div style={{ fontSize: t.size }}>{t.sample}</div>
              </div>
            ))}
          </div>
        </SubSection>

        <SubSection title="Pesos">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {[
              { weight: 400, label: 'Regular' },
              { weight: 500, label: 'Medium' },
              { weight: 600, label: 'Semibold' },
              { weight: 700, label: 'Bold' },
            ].map((w) => (
              <div key={w.weight} style={{ fontSize: 'var(--fs-base)', fontWeight: w.weight }}>
                {w.label} <span style={{ color: 'var(--muted)', fontSize: 'var(--fs-micro)' }}>({w.weight})</span>
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

      {/* BOTONES */}
      <Section id="buttons" title="Botones">
        <SubSection title="Variantes">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Danger</Button>
          </div>
          <CodeSnippet>{`<Button variant="primary">Primary</Button>`}</CodeSnippet>
        </SubSection>

        <SubSection title="Tamaños">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary" size="sm">Small</Button>
            <Button variant="primary" size="md">Medium</Button>
            <Button variant="primary" size="lg">Large</Button>
          </div>
        </SubSection>

        <SubSection title="Estados">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="primary">Normal</Button>
            <Button variant="primary" disabled>Disabled</Button>
            <Button variant="primary" loading>Loading</Button>
            <Button variant="secondary" icon={<span>↗</span>}>Con icono</Button>
          </div>
        </SubSection>
      </Section>

      {/* STATUS PILL */}
      <Section id="pills" title="StatusPill">
        <SubSection title="Tonos">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill tone="ok">OK</StatusPill>
            <StatusPill tone="warn">Atención</StatusPill>
            <StatusPill tone="danger">Error</StatusPill>
            <StatusPill tone="neutral">Neutral</StatusPill>
          </div>
          <CodeSnippet>{`<StatusPill tone="ok">ENCONTRADO</StatusPill>`}</CodeSnippet>
        </SubSection>

        <SubSection title="Con dot (estado activo)">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill tone="ok" dot>Sincronizado</StatusPill>
            <StatusPill tone="warn" dot>Pendiente</StatusPill>
            <StatusPill tone="danger" dot>Caído</StatusPill>
          </div>
        </SubSection>

        <SubSection title="Variant dark (sobre fondos claros enfáticos)">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <StatusPill tone="ok" variant="dark" dot>Activo</StatusPill>
            <StatusPill tone="warn" variant="dark">Espera</StatusPill>
            <StatusPill tone="neutral" variant="dark">Default</StatusPill>
          </div>
        </SubSection>
      </Section>

      {/* ALERT BOX */}
      <Section id="alerts" title="AlertBox">
        <div style={{ display: 'grid', gap: 8 }}>
          <AlertBox tone="info">Esto es información general que el usuario debe leer.</AlertBox>
          <AlertBox tone="success">Operación completada con éxito.</AlertBox>
          <AlertBox tone="warn">Esto requiere atención del operador.</AlertBox>
          <AlertBox tone="error">Algo falló y debe revisarse.</AlertBox>
        </div>
        <CodeSnippet>{`<AlertBox tone="info">Mensaje</AlertBox>`}</CodeSnippet>
      </Section>

      {/* FIELDS */}
      <Section id="fields" title="Fields / Formularios">
        <SubSection title="Field con diferentes inputs">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
            <Field label="Nombre">
              <input placeholder="Texto del input" />
            </Field>
            <Field label="Email">
              <input type="email" placeholder="correo@ejemplo.com" />
            </Field>
            <Field label="Periodo">
              <select>
                <option>202615</option>
                <option>202610</option>
              </select>
            </Field>
            <Field label="Cantidad">
              <input type="number" placeholder="0" />
            </Field>
          </div>
          <CodeSnippet>{`<Field label="Nombre">
  <input value={...} onChange={...} />
</Field>`}</CodeSnippet>
        </SubSection>

        <SubSection title="FilterBar">
          <FilterBar>
            <Field label="Buscar">
              <input placeholder="Texto..." />
            </Field>
            <Field label="Estado">
              <select>
                <option>Todos</option>
                <option>Activos</option>
              </select>
            </Field>
            <Button variant="primary" size="sm">Aplicar</Button>
            <Button variant="ghost" size="sm">Limpiar</Button>
          </FilterBar>
        </SubSection>
      </Section>

      {/* STATS GRID */}
      <Section id="stats" title="StatsGrid (KPIs)">
        <StatsGrid
          items={[
            { label: 'Total NRC', value: '1,234', tone: 'default' },
            { label: 'Con docente', value: '987', tone: 'ok' },
            { label: 'Sin docente', value: '247', tone: 'warn' },
            { label: 'Errores Banner', value: '12', tone: 'danger' },
          ]}
          columns={4}
        />
        <CodeSnippet>{`<StatsGrid
  items={[
    { label: 'Total', value: '1,234', tone: 'default' },
    { label: 'OK', value: '987', tone: 'ok' },
  ]}
  columns={4}
/>`}</CodeSnippet>
      </Section>

      {/* TABLAS */}
      <Section id="tables" title="Tablas (densas operativas)">
        <SubSection title="Tabla denser (estilo NRC globales)">
          <div style={{ overflow: 'auto', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)' }}>
            <table className="ds-table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th>NRC</th>
                  <th>Periodo</th>
                  <th>Docente</th>
                  <th>Banner</th>
                  <th>Moodle</th>
                  <th>Calificación</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>15-72648</td>
                  <td>202615</td>
                  <td>Jefferson Díaz Chico</td>
                  <td><StatusPill tone="ok">ENCONTRADO</StatusPill></td>
                  <td><StatusPill tone="ok">OK</StatusPill></td>
                  <td>A: 50 | E: 47.9</td>
                </tr>
                <tr>
                  <td>15-72741</td>
                  <td>202615</td>
                  <td>Camila Remicio</td>
                  <td><StatusPill tone="warn">SIN_DOCENTE</StatusPill></td>
                  <td><StatusPill tone="neutral">SIN_CHECK</StatusPill></td>
                  <td>-</td>
                </tr>
                <tr>
                  <td>15-72749</td>
                  <td>202615</td>
                  <td>Sandra Hernández</td>
                  <td><StatusPill tone="danger">NO_ENCONTRADO</StatusPill></td>
                  <td><StatusPill tone="ok">OK</StatusPill></td>
                  <td>A: 36.7 | E: 46.4</td>
                </tr>
              </tbody>
            </table>
          </div>
        </SubSection>

        <SubSection title="VirtualTable — 600 filas virtualizadas, expandible y seleccionable">
          <AlertBox tone="info">
            Renderiza solo las filas visibles (windowing manual, sin librería).
            Click en una fila para expandir su detalle. Usar en listados &gt;200 filas.
          </AlertBox>
          <div style={{ marginTop: 12 }}>
            <VirtualTable
              rows={DEMO_ROWS}
              columns={vtColumns}
              rowKey={(r) => r.id}
              maxHeight={360}
              selectedKeys={vtSelected}
              expandedKeys={vtExpanded}
              onRowClick={(r) => {
                setVtExpanded((prev) => {
                  const next = new Set(prev);
                  next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                  return next;
                });
                setVtSelected((prev) => {
                  const next = new Set(prev);
                  next.has(r.id) ? next.delete(r.id) : next.add(r.id);
                  return next;
                });
              }}
              renderExpanded={(r) => (
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 'var(--fs-sm)' }}>
                  <div><strong>NRC:</strong> {r.nrc}</div>
                  <div><strong>Docente:</strong> {r.teacher}</div>
                  <div><strong>Estado Banner:</strong> {r.banner}</div>
                  <div><strong>Calificación:</strong> {r.grade}</div>
                </div>
              )}
              emptyState="No hay NRC con los filtros actuales."
            />
          </div>
          <CodeSnippet>{`<VirtualTable
  rows={items}
  rowKey={(r) => r.id}
  columns={[
    { key: 'nrc', header: 'NRC', width: '110px', render: (r) => r.nrc },
    { key: 'teacher', header: 'Docente', render: (r) => r.teacher },
  ]}
  maxHeight={360}
  expandedKeys={expanded}
  selectedKeys={selected}
  onRowClick={(r) => toggleExpand(r.id)}
  renderExpanded={(r) => <DetailPanel row={r} />}
/>`}</CodeSnippet>
        </SubSection>
      </Section>

      {/* OVERLAYS */}
      <Section id="overlays" title="Modales, Toasts y Confirmaciones">
        <SubSection title="Modal">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>Abrir modal (md)</Button>
            <Button variant="secondary" size="sm" onClick={() => setModalSm(true)}>Abrir modal (sm)</Button>
          </div>
          <Modal
            open={modalOpen}
            onClose={() => setModalOpen(false)}
            title="Ejemplo de modal"
            size="md"
            footer={
              <>
                <Button variant="ghost" size="sm" onClick={() => setModalOpen(false)}>Cancelar</Button>
                <Button variant="primary" size="sm" onClick={() => setModalOpen(false)}>Aceptar</Button>
              </>
            }
          >
            <p style={{ lineHeight: 1.6 }}>
              Contenido del modal. Cierra con Escape, clic en overlay o el botón ✕.
              El scroll del body queda bloqueado mientras está abierto.
            </p>
          </Modal>
          <Modal open={modalSm} onClose={() => setModalSm(false)} title="Modal pequeño" size="sm">
            <p>Tamaño <code>sm</code> — ideal para confirmaciones o formularios cortos.</p>
          </Modal>
          <CodeSnippet>{`<Modal open={open} onClose={() => setOpen(false)} title="Título" size="md"
  footer={<Button onClick={...}>Aceptar</Button>}>
  contenido
</Modal>`}</CodeSnippet>
        </SubSection>

        <SubSection title="Toasts">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" onClick={() => toast.success('Operación completada')}>success</Button>
            <Button variant="secondary" size="sm" onClick={() => toast.error('Algo falló', { title: 'Error' })}>error</Button>
            <Button variant="secondary" size="sm" onClick={() => toast.warn('Revisa los datos')}>warn</Button>
            <Button variant="secondary" size="sm" onClick={() => toast.info('Sincronización en curso')}>info</Button>
            <Button variant="ghost" size="sm" onClick={() => toast.show('Persistente — ciérralo manualmente', { duration: 0 })}>persistente</Button>
          </div>
          <CodeSnippet>{`const toast = useToast();
toast.success('Listo');
toast.error('Falló', { title: 'Error' });
toast.show('Mensaje', { tone: 'info', duration: 0 }); // 0 = no auto-cierra`}</CodeSnippet>
        </SubSection>

        <SubSection title="Confirmación">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={async () => {
                const ok = await confirm({ message: '¿Continuar con esta acción?' });
                toast.info(ok ? 'Confirmado' : 'Cancelado');
              }}
            >
              Confirmar (primary)
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                const ok = await confirm({
                  title: 'Eliminar registro',
                  tone: 'danger',
                  confirmLabel: 'Eliminar',
                  message: 'Esta acción no se puede deshacer.',
                });
                toast[ok ? 'error' : 'info'](ok ? 'Eliminado' : 'Cancelado');
              }}
            >
              Confirmar (danger)
            </Button>
          </div>
          <CodeSnippet>{`const confirm = useConfirm();
const ok = await confirm({
  title: 'Eliminar', tone: 'danger', confirmLabel: 'Eliminar',
  message: 'Esta acción no se puede deshacer.',
});
if (!ok) return;`}</CodeSnippet>
        </SubSection>
      </Section>

      {/* PATRONES */}
      <Section id="patterns" title="Patrones de layout">
        <SubSection title="Panel expandible (2 columnas)">
          <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 16px', borderBottom: '1px solid var(--line)', background: 'var(--n-50)' }}>
              <StatusPill tone="neutral">NRC: 15-72548</StatusPill>
              <StatusPill tone="neutral">202615</StatusPill>
              <StatusPill tone="ok">Checklist ✓</StatusPill>
              <StatusPill tone="ok">Cal: 50</StatusPill>
              <StatusPill tone="neutral">Part: 28</StatusPill>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <div style={{ padding: '12px 16px', borderRight: '1px solid var(--line)' }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em', marginBottom: 6 }}>Moodle</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                  <a href="#" style={{ color: 'var(--primary)', textDecoration: 'underline', fontWeight: 600, fontSize: 'var(--fs-base)' }}>Ir al curso ↗</a>
                  <StatusPill tone="neutral">ID: 744</StatusPill>
                  <StatusPill tone="neutral">DISTANCIA</StatusPill>
                </div>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em', marginBottom: 6 }}>Historial</div>
                <table style={{ width: '100%', fontSize: 'var(--fs-sm)', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--n-50)' }}>
                      <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Fase</th>
                      <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Cal.</th>
                      <th style={{ padding: '4px 6px', textAlign: 'left', fontWeight: 600 }}>Fecha</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--line2)' }}>
                      <td style={{ padding: '3px 6px' }}>EJECUCION</td>
                      <td style={{ padding: '3px 6px', fontWeight: 700 }}>45</td>
                      <td style={{ padding: '3px 6px' }}>29/4/2026</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '3px 6px' }}>ALISTAMIENTO</td>
                      <td style={{ padding: '3px 6px', fontWeight: 700 }}>50</td>
                      <td style={{ padding: '3px 6px' }}>29/4/2026</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '12px 16px' }}>
                <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: '0.05em', marginBottom: 8 }}>Acciones</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Fase</label>
                    <select style={{ width: '100%', fontSize: 'var(--fs-base)' }}>
                      <option>ALISTAMIENTO</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', display: 'block', marginBottom: 3 }}>Calificación</label>
                    <input type="number" defaultValue={50} style={{ width: '100%', fontSize: 'var(--fs-base)' }} />
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <Button variant="primary" size="sm">Guardar</Button>
                  <Button variant="secondary" size="sm">+ Reenviar</Button>
                  <Button variant="danger" size="sm">Eliminar</Button>
                </div>
              </div>
            </div>
          </div>
          <CodeSnippet>{`/* Panel detalle expandible — pills arriba, 2 columnas abajo */
<div style={{ background: 'var(--surface)', borderRadius: 'var(--radius-md)' }}>
  <div className="pills-row">{/* StatusPills */}</div>
  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
    <div>{/* info + historial */}</div>
    <div>{/* acciones */}</div>
  </div>
</div>`}</CodeSnippet>
        </SubSection>

        <SubSection title="Anti-patrones (NO hacer)">
          <div style={{ display: 'grid', gap: 8, fontSize: 'var(--fs-sm)' }}>
            {[
              '<button> HTML con estilos inline — usar <Button>',
              '<span className="badge"> inline — usar <StatusPill>',
              'Colores hardcoded (#1e40af) — usar var(--primary)',
              'Padding > 24px en paneles operativos',
              'Headers con <h3> + caja gris grande — usar uppercase label pequeño',
              'Cards anidadas (caja dentro de caja dentro de caja)',
              'Sombras pesadas — usar shadow-sm o menos',
              'Crear estilos sin pasar por _components/ui/',
            ].map((rule) => (
              <div key={rule} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--red)', fontWeight: 700 }}>✕</span>
                <span>{rule}</span>
              </div>
            ))}
          </div>
        </SubSection>
      </Section>

    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: '20px 24px',
        scrollMarginTop: '80px',
      }}
    >
      <h2 style={{
        margin: '0 0 16px',
        fontSize: 'var(--fs-lg)',
        fontWeight: 700,
        color: 'var(--ink)',
        letterSpacing: '-0.01em',
      }}>{title}</h2>
      <div style={{ display: 'grid', gap: 20 }}>
        {children}
      </div>
    </section>
  );
}

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{
        fontSize: 'var(--fs-micro)',
        fontWeight: 700,
        textTransform: 'uppercase',
        color: 'var(--muted)',
        letterSpacing: '0.05em',
        marginBottom: 10,
      }}>
        {title}
      </div>
      <div style={{ display: 'grid', gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function ColorGrid({ colors }: { colors: { name: string; value: string; desc: string }[] }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
      gap: 8,
    }}>
      {colors.map((c) => (
        <div key={c.name} style={{
          display: 'grid',
          gridTemplateColumns: '40px 1fr',
          gap: 10,
          padding: '8px 10px',
          border: '1px solid var(--line2)',
          borderRadius: 'var(--radius)',
          alignItems: 'center',
        }}>
          <div style={{
            width: 40,
            height: 40,
            background: c.value,
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
          }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, fontFamily: 'var(--font-mono)', color: 'var(--ink)' }}>{c.name}</div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{c.value}</div>
            <div style={{ fontSize: 'var(--fs-micro)', color: 'var(--subtle)', marginTop: 2 }}>{c.desc}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CodeSnippet({ children }: { children: string }) {
  return (
    <pre style={{
      margin: 0,
      padding: '10px 12px',
      background: 'var(--n-50)',
      border: '1px solid var(--line2)',
      borderRadius: 'var(--radius)',
      fontFamily: 'var(--font-mono)',
      fontSize: 'var(--fs-xs)',
      color: 'var(--n-700)',
      overflowX: 'auto',
      whiteSpace: 'pre',
    }}>
      <code>{children}</code>
    </pre>
  );
}
