'use client';

/**
 * TEMPLATE — copiar a _features/<nombre>/<nombre>-panel.tsx
 *
 * Checklist antes de entregar:
 *  [ ] Renombrar NombrePanel, NombrePanelProps
 *  [ ] Reemplazar /api/ENDPOINT por el endpoint real
 *  [ ] Agregar sección al menú en _components/main-menu.tsx
 *  [ ] Agregar tipo en MainMenuSection (main-menu.tsx)
 *  [ ] Crear page.tsx en (modulos)/<nombre>/
 *  [ ] Verificar build: pnpm -C web-v2 build
 */

import { useEffect, useState } from 'react';
import { fetchJson } from '../../_lib/http';
import { AlertBox, Button, PageHero } from '../../_components/ui';

type NombrePanelProps = {
  apiBase: string;
};

type Item = {
  id: string;
  // TODO: definir campos
};

type ListResponse = {
  ok: boolean;
  total: number;
  items: Item[];
};

export function NombrePanel({ apiBase }: NombrePanelProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError('');
        const data = await fetchJson<ListResponse>(`${apiBase}/ENDPOINT`);
        setItems(data.items ?? []);
      } catch (err) {
        setError(`Error al cargar: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [apiBase]);

  return (
    <div className="premium-card">
      <PageHero
        title="Nombre del módulo"
        description="Descripción breve de qué hace este panel."
      />

      {error && <AlertBox tone="error">{error}</AlertBox>}

      {loading && (
        <p className="muted">Cargando…</p>
      )}

      {!loading && !error && items.length === 0 && (
        <p className="muted">Sin datos disponibles.</p>
      )}

      {!loading && items.length > 0 && (
        <div className="fast-table-wrapper">
          <table className="fast-table">
            <thead>
              <tr>
                <th>ID</th>
                {/* TODO: agregar columnas */}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  {/* TODO: agregar celdas */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="controls" style={{ marginTop: 16 }}>
        <Button variant="primary" size="sm" onClick={() => void 0}>
          Acción principal
        </Button>
      </div>
    </div>
  );
}
