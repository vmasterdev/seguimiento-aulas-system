# Design System — Seguimiento de Aulas

Sistema institucional UNIMINUTO · Consola Operativa · Estilo **denso operativo**

## Filosofía

1. **Densidad operativa**: maximizar información visible. Operadores revisan cientos de NRC/docentes/cursos por sesión. Padding agresivo es enemigo.
2. **Performance primero**: render rápido es parte del diseño. Tablas con miles de filas deben ser fluidas. No animaciones pesadas, no sombras costosas en items repetidos, virtualización cuando >200 filas, `useMemo` para filtros/sort, lazy loading de detalles.
3. **Una sola línea visual**: misma paleta, mismos componentes, mismos espacios en TODO el sistema.
4. **Flat dentro de paneles**: un nivel de contenedor. No cajas dentro de cajas dentro de cajas.
5. **Jerarquía por tipografía, no por color**: bold, uppercase, size — antes que fondos saturados.
6. **Color = información, no decoración**: rojo = peligro/error, ámbar = atención, verde = OK, primario = acción.

## Reglas de performance (obligatorias)

- **Listados grandes** (>200 filas): virtualizar con `react-window` o paginar. Nunca renderizar 5000 `<tr>` simultáneos.
- **Filtros/búsqueda**: siempre `useMemo` con deps correctas. Nunca recalcular en cada render.
- **Detalles de fila**: cargar bajo demanda (lazy). No fetchear detalle de las 5000 filas al cargar.
- **Animaciones**: máximo `transition: all 120-180ms`. Nada de `transform` complejo en hover de filas repetidas.
- **Sombras en filas**: prohibido `box-shadow` en cada `<tr>`. Solo borde inferior.
- **Imágenes/iconos**: SVG inline solo si <2KB. Resto via `next/image`.
- **Bundles**: importar de barrel `_components/ui` (tree-shakeable), NO importar archivos sueltos no usados.
- **Mediciones**: si una página tarda >500ms en interacciones, abrir DevTools Performance, identificar bottleneck antes de "optimizar a ciegas".

## Tokens (definidos en `web-v2/app/globals.css`)

### Paleta institucional

| Token | Valor | Uso |
|---|---|---|
| `--primary` | `#1b3a6b` | Azul naval. Botones primarios, links activos, headers. |
| `--primary-dark` | `#122850` | Hover/active de primario. |
| `--primary-light` | `#e8edf7` | Fondos sutiles, badges suaves. |
| `--gold` | `#b8841a` | Acento institucional UNIMINUTO. Uso escaso (decoraciones, brand). |
| `--ink` | `#111827` | Texto principal. |
| `--muted` | `#6b7280` | Texto secundario, labels. |
| `--subtle` | `#9ca3af` | Texto deshabilitado, hints. |
| `--bg` | `#eef2f7` | Fondo de app. |
| `--surface` | `#ffffff` | Fondo de tarjetas, paneles. |
| `--line` | `#dce3ef` | Bordes principales. |
| `--line2` | `#eef1f7` | Bordes sutiles, divisores internos. |

### Semánticos

| Token | Valor | Uso |
|---|---|---|
| `--green` / `--green-light` | `#10b981` / `#ecfdf5` | OK, éxito, encontrado. |
| `--amber` / `--amber-light` | `#f59e0b` / `#fffbeb` | Advertencia, atención requerida. |
| `--red` / `--red-light` | `#ef4444` / `#fef2f2` | Error, peligro, eliminar. |
| `--blue` / `--blue-light` | `#3b82f6` / `#eff6ff` | Información neutral. |

### Tipografía

- Display: `--font-display` — Segoe UI Variable Display / DM Sans
- Body: `--font-body` — Segoe UI / system
- Mono: `--font-mono` — Cascadia Code / JetBrains Mono

Escala (densa):
- `0.68rem` — labels uppercase, hints
- `0.78rem` — datos en tablas
- `0.85rem` — formularios, body normal
- `0.95rem` — títulos de sección (h3)
- `1.1rem` — títulos de página (h2)
- `1.4rem` — KPI values

### Espacios

Sistema de 4px:
- `4px` — micro (gap entre badges, pills)
- `6px` — small (padding de table cells)
- `8px` — base (padding form rows)
- `12px` — medium (padding card sections)
- `16px` — large (separación entre secciones)
- `24px` — xl (padding de página)
- `32px` — xxl (gutters)

### Radios

- `--radius` = 6px (default)
- `--radius-md` = 8px
- `--radius-lg` = 12px

Pills/badges: `999px` (full pill).

### Sombras

- `--shadow-xs` — hover sutil
- `--shadow-sm` — cards default
- `--shadow` — cards elevadas
- `--shadow-md` — modales, dropdowns

## Componentes (todos en `web-v2/app/_components/ui/`)

**REGLA DE ORO**: Si necesitas un componente, primero busca en `_components/ui/`. Si no existe, **créalo ahí** antes de inline. Nunca dupliques estilos.

### Button (`button.tsx`)

Variantes: `primary` | `secondary` | `ghost` | `danger`
Sizes: `sm` | `md` (default) | `lg`

```tsx
<Button variant="primary" size="sm" onClick={...}>Guardar</Button>
```

NO usar `<button>` HTML crudo en paneles operativos. Solo en casos especiales (cierre de modal, etc).

### Field (`field.tsx`)

Wrapper de inputs con label uniforme.

```tsx
<Field label="Nombre">
  <input value={...} onChange={...} />
</Field>
```

### StatusPill (`status-pill.tsx`)

Tone: `ok` | `warn` | `danger` | `neutral`
Variant: `light` (default) | `dark`

```tsx
<StatusPill tone="ok">ENCONTRADO</StatusPill>
<StatusPill tone="warn" dot>Pendiente</StatusPill>
```

### AlertBox (`alert-box.tsx`)

Tone: `info` | `success` | `warn` | `error`

```tsx
<AlertBox tone="info">Mensaje informativo</AlertBox>
```

### StatsGrid (`stats-grid.tsx`)

KPIs en fila/grid. Para el hero/header de páginas operativas.

### DataTable (`data-table.tsx`)

Tabla estilizada con columnas declarativas. Para listados densos.

### FilterBar (`filter-bar.tsx`)

Barra horizontal de filtros con padding consistente.

### PageHero (`page-hero.tsx`)

Header de página con título, descripción, status pills, acciones.

## Layouts estándar

### Página operativa estándar

```
┌─────────────────────────────────────────────┐
│  PageHero (título + status + acciones)      │
├─────────────────────────────────────────────┤
│  StatsGrid (KPIs en fila)                   │
├─────────────────────────────────────────────┤
│  FilterBar (búsqueda + filtros)             │
├─────────────────────────────────────────────┤
│  DataTable (listado denso)                  │
│  └─ row expandible: detalle 2 columnas      │
└─────────────────────────────────────────────┘
```

### Panel expandible (row detail)

Layout 2 columnas obligatorio para densidad:
- Izquierda: información + historial
- Derecha: acciones + formularios

Pills resumen arriba en fila compacta. NO secciones verticales largas con headers grandes.

### Tablas — estándar visual

- Padding cells: `4-8px` vertical, `6-12px` horizontal
- Font: `var(--fs-sm)` (0.78rem) para data, `var(--fs-micro)` para headers uppercase
- Header: background `var(--n-50)`, uppercase, semibold, letter-spacing `0.04em`
- Filas: borde inferior `1px solid var(--line2)`. Sin sombras.
- Hover: background `var(--n-50)` con transición `120ms`
- Selección: background `rgba(27, 58, 107, 0.06)`
- Row expandida: background `var(--n-50)` en el `<td colSpan>`
- Sticky header en tablas largas con `position: sticky; top: 0`
- Para >200 filas: paginar o virtualizar. Nunca renderizar 5000 filas crudas.

## Anti-patrones (NO HACER)

- ❌ `<button>` HTML con estilos inline en paneles. Usar `<Button>`.
- ❌ Pills/badges con `<span className="badge">` inline. Usar `<StatusPill>`.
- ❌ Colores hardcoded en JSX (`#1e40af`). Usar tokens (`var(--primary)`).
- ❌ Padding > 24px dentro de paneles operativos.
- ❌ Headers de sección con `<h3>` + caja gris grande. Usar uppercase label pequeño.
- ❌ Múltiples niveles de cards anidadas. UN solo nivel.
- ❌ Sombras pesadas. Usar `--shadow-sm` o menos.
- ❌ Crear estilos nuevos sin pasar por componente UI.
- ❌ Inventar nombres de tokens. Si falta un token, agregarlo a `globals.css`.

## Showcase

Ruta `/design-system` muestra todos los componentes con sus variantes. **Antes de implementar UI nueva, revisar esa página.**

## Workflow para nuevas páginas

1. Importar de `_components/ui/`: `import { Button, Field, StatusPill, ... } from '../../_components/ui'`
2. Estructura: `PageShell > PageHero > StatsGrid > FilterBar > DataTable`
3. Spacing: gap 12-16px entre secciones
4. Detalles densos: padding 8-12px, font 0.78-0.85rem
5. Si necesitas un componente nuevo, créalo en `_components/ui/` con su token-style

## Migración

Páginas se migran en orden de uso real:
1. NRC Globales ✓ (parcial)
2. Docentes
3. Banner
4. Correos
5. Resto (Centros, Horarios, Aulas, Recargos, Reportes, etc.)
