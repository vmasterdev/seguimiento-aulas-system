# Historial de Cambios — Seguimiento Aulas

Este archivo documenta los cambios realizados al sistema, decisiones de diseño y estado actual de cada módulo.
Está pensado como contexto para futuras sesiones de trabajo con IA o con el equipo.

---

## Stack y arquitectura base

| Capa | Tecnología | Puerto |
|---|---|---|
| API | NestJS + Prisma + BullMQ | 3001 |
| Frontend | Next.js 14 (App Router) | 3000 |
| Worker | Playwright (automatización Moodle) | — |
| DB | PostgreSQL | 25433 |
| Cache | Redis | 36380 |

**Arranque local:**
```bash
pnpm stack:up        # levanta todo vía tmux en WSL
pnpm stack:status    # estado actual
pnpm stack:down      # baja servicios
```

Los servicios corren en sesiones tmux WSL: `seguimiento_api`, `seguimiento_web`, `seguimiento_worker`.

---

## Módulos del sistema

### Momentos / fases

| Código en BD | Alias de entrada | Descripción | Duración |
|---|---|---|---|
| `MD1` | `RY1`, `M1`, `MOMENTO1` | Momento 1 | ~7 semanas |
| `MD2` | `RY2`, `M2`, `MOMENTO2` | Momento 2 | ~7 semanas |
| `1` | `RYC`, `SEMESTRAL` | Semestral completo | 16 semanas |
| `INTER` | — | Intersemestral | — |
| `RM1`, `RM2` | — | Remediales | — |

El normalizador vive en `packages/shared/src/normalizers.ts`. En BD siempre queda el código canónico.

### Puntaje de evaluación

- **Alistamiento**: 0–50 pts
- **Ejecución**: 0–50 pts
- **Total**: 0–100 pts

| Banda | Rango | Color |
|---|---|---|
| Excelente | 91–100 | Verde |
| Bueno | 80–90 | Azul |
| Aceptable | 70–79 | Amarillo |
| Insatisfactorio | 0–69 | Rojo |

---

## Cambios realizados (sesión abril 2026)

### 1. Botones NRC Global — estilo visual
**Archivo:** `web-v2/app/_features/nrc/nrc-global-panel.tsx`

Los botones "Guardar solo NRC", "Guardar NRC + replicas" y "Guardar + preview + reenviar" no tenían color.
Se aplicaron estilos inline (azules en degradé) porque la regla CSS `.panel button` los hacía invisibles al asignar `background: var(--surface)` igual al fondo blanco del panel.

**Patrón para botones visibles en paneles blancos:**
```tsx
style={{ background: '#1e40af', color: '#fff' }}   // primario
style={{ background: '#f3f4f6', color: '#111827' }} // secundario
```

### 2. Modal de preview en NRC Global — botón cerrar
**Archivo:** `web-v2/app/_features/nrc/nrc-global-panel.tsx`

El modal de preview de correo no tenía botón visible para cerrar.
Se reemplazó el botón "Cerrar" por un `✕` con estilo explícito y se agregó `onClick` en el backdrop para cerrar al hacer clic fuera.

### 3. Actualización visual de NRC réplica tras guardado
**Archivo:** `web-v2/app/_features/nrc/nrc-global-panel.tsx`

Al guardar con "Guardar NRC + replicas", los NRC del mismo grupo no actualizaban visualmente su puntuación.

**Solución:** Después del save con `replicateToGroup: true`, se identifican los NRC del mismo `sampleGroup` usando `item.selectedSampleGroups` y se recargan todos en paralelo:
```ts
const originGroupIds = course.selectedSampleGroups?.map((g) => g.id) ?? [];
const groupMates = items.filter(
  (item) => item.id !== course.id &&
  item.selectedSampleGroups?.some((g) => originGroupIds.includes(g.id)),
);
await Promise.all(groupMates.map((mate) => loadCourseDetail(mate.id)));
```

### 4. Sidecar Moodle — simplificación para usuarios no técnicos
**Archivo:** `web-v2/app/_features/sidecar/sidecar-integration-panel.tsx`

Cambios:
- Se eliminó el `<select>` de tarea duplicado (las cards ya hacen esa selección)
- Workers/browser/python envueltos en `<details>` "Configuración avanzada"
- Hints de flujo en `<details>` "Cuándo usar cada opción"
- Config path + log en `<details>` "Información técnica del proceso"
- Cards corregidas: texto se amontonaba por la regla global `button { white-space: nowrap }`. Fix: `whiteSpace: 'normal'` en inline styles de los botones dentro de cards
- Grid cambiado a `auto-fill minmax(220px, 1fr)`

### 5. Tabla de Docentes — botones Editar y Eliminar
**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

Se agregaron:
- Botón **Editar** (azul `#1e40af`) que prefillerea el formulario con los datos del docente
- Botón **Eliminar** (rojo `#9f1239`) con `window.confirm()` antes de llamar `DELETE /teachers/:id`
- Lo mismo para la tabla de coordinadores: Editar + Eliminar con `DELETE /coordinators/:id`

### 6. Módulo Reportes de Cierre — `/reportes`
**Archivos nuevos:**
- `web-v2/app/(modulos)/reportes/page.tsx`
- `web-v2/app/_features/reportes/cierre-panel.tsx`

**Menú:** `web-v2/app/_components/main-menu.tsx` — se agregó entrada "Reportes Cierre" con `ICON_REPORT`

#### Qué hace el panel `/reportes`

1. Carga NRC con `GET /courses?limit=5000`
2. Carga coordinadores con `GET /coordinators?limit=500` (para cruzar emails)
3. Filtra por periodo + momento
4. Agrupa por docente, calcula promedios (alistamiento + ejecución)
5. Genera HTML de reportes con 3 tipos:

| Tipo | Audiencia | Contenido |
|---|---|---|
| **Docente** | Cada profesor | Puntaje total, desglose por aula, mensaje personalizado por banda |
| **Coordinación** | Coordinadores de programa | Tabla de docentes, distribución por banda, alertas |
| **Directivos** | Subdirección / Dirección / Vicerrectoría | KPIs institucionales, tabla por coordinación, recomendaciones |

#### Flujo de envío por correo

```
Frontend genera HTML
    ↓
POST /outbox/queue-cierre
  { periodCode, moment, audience, items: [{ recipientName, recipientEmail, teacherId, subject, htmlBody }] }
    ↓
API guarda OutboxMessage (phase='CIERRE', moment='CIERRE_MD1', audience='CIERRE_DOCENTE')
    ↓
POST /outbox/send { ids: [...] }
    ↓
SMTP despacha correos
```

**Para docentes:** usa `entry.teacherEmail` del curso
**Para coordinaciones:** cruza el nombre de coordinación con `Coordinator.programId` por matching normalizado
**Para directivos:** inputs manuales de email (3 campos: Subdirección, Dirección, Vicerrectoría)

#### Nuevo endpoint API

```
POST /outbox/queue-cierre
Body: {
  periodCode: string,         // ej: "202615"
  moment: string,             // ej: "MD1"
  audience: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL',
  items: Array<{
    recipientName: string,
    recipientEmail: string | null,
    teacherId?: string,
    coordinatorId?: string,
    subject: string,
    htmlBody: string,         // HTML completo generado en el frontend
  }>,
  dryRun?: boolean,
}
Respuesta: { ok, created, createdMessageIds }
```

**Archivos API modificados:**
- `apps/api/src/modules/outbox/outbox.schemas.ts` — `OutboxQueueCierreSchema`
- `apps/api/src/modules/outbox/outbox.service.ts` — método `queueCierre()`
- `apps/api/src/modules/outbox/outbox.controller.ts` — `POST /outbox/queue-cierre`

#### Por qué el HTML se genera en el frontend

Los reportes de cierre combinan ALISTAMIENTO + EJECUCIÓN (score total 0–100) en un único reporte. El outbox existente trabaja por fase separada. Para no duplicar los constructores HTML en el API, el frontend genera el HTML y lo envía al endpoint de cola, que solo almacena y despacha.

Los mensajes CIERRE no se "refrescan" antes de enviar (el refresh del servicio existente retorna `null` para audiencias desconocidas como `CIERRE_DOCENTE`), por lo que se envía exactamente el HTML generado.

### 7. Sección Insatisfactorios — Notificaciones de Plan de Mejora
**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

Nueva sección **"6. Docentes con Resultado Insatisfactorio"** que aparece automáticamente en `/reportes` cuando hay docentes con puntaje < 55 en el periodo/momento cargado.

**Qué incluye:**
- Tabla ordenada de menor a mayor puntaje: nombre, coordinación, alistamiento, ejecución, total y déficit respecto al mínimo de 55 pts
- Por fila: botones Preview, Descargar y Notificar (envío individual)
- Botones globales: Descargar todos + Notificar a todos
- Solo aparece si hay insatisfactorios; si todos pasan, no se muestra

**Reporte HTML generado (`buildInsatisfactorioReport`):**
- Header rojo/naranja (distinto al azul de los reportes normales)
- Top strip degradé rojo → naranja
- KPIs con barras de color rojo/naranja según déficit
- Sección "Plan de Mejora" con pasos numerados adaptativos:
  - Si alistamiento crítico (< 25 pts): pasos específicos de estructura del aula
  - Si ejecución crítica (< 25 pts): pasos de retroalimentación, comunicación y calificaciones
  - Ambas secciones si ambas son críticas
- Sección de soporte indicando coordinación y equipo de Campus Virtual

**Envío:** usa la misma infraestructura `queueAndSend('DOCENTE', items)` → `POST /outbox/queue-cierre` → `POST /outbox/send`. Subject: `[UNIMINUTO] Plan de Mejora — Campus Virtual Momento X — PERIODO`.

### 8. Fix — Campos anidados del API en CierrePanel
**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

El panel de `/reportes` cargaba los NRC pero no mostraba ningún reporte. Causa: el tipo `CourseItem` usaba nombres de campo planos que no coincidían con la respuesta real del API.

**Mapeo corregido:**

| Campo incorrecto (antes) | Campo real del API |
|---|---|
| `c.periodCode` | `c.period.code` (objeto anidado) |
| `c.teacherName` | `c.teacher.fullName` (objeto anidado) |
| `c.teacherEmail` | `c.teacher.email` (objeto anidado) |
| `c.coordination` | `c.teacher.coordination` (objeto anidado) |
| `c.campus` | `c.teacher.campus` (objeto anidado) |

**Otros fixes en la misma sesión:**
- Select de momentos corregido: `"1"` → Momento 1 era incorrecto (ese código es RYC/Semestral). Ahora `MD1 = Momento 1`, `MD2 = Momento 2`, `1 = Semestral/RYC`
- Default de periodo cambiado de `'202615'` (hardcoded) a `''` con auto-detección: al cargar, el panel toma el código de periodo más reciente que haya en los datos
- Default de momento cambiado de `'1'` a `'MD1'`

---

## Reportes de ejemplo generados

En `storage/outputs/reports/`:

| Archivo | Tipo |
|---|---|
| `reporte-docente-ejemplo.html` | Docente individual (Excelente, 91.3/100) |
| `reporte-coordinacion-ejemplo.html` | Coordinación Ing. Sistemas (8 docentes) |
| `reporte-directivos-ejemplo.html` | Ejecutivo institucional (34 docentes, 5 coordinaciones) |
| `reporte-cierre-semestre-ejemplo.html` | Cierre semestral con evolución M1→M2 |
| `reporte-cierre-anual-ejemplo.html` | Informe anual 2026 (comparativa 202515 vs 202615) |

---

## Decisiones de diseño y advertencias

### CSS global — botones invisibles
La regla `.panel button { background: var(--surface) }` en `globals.css` hace invisibles los botones dentro de paneles blancos. **Siempre usar estilos inline** para botones en paneles:
```tsx
style={{ background: '#1e40af', color: '#fff' }}        // primario
style={{ background: '#f3f4f6', color: '#111827' }}     // secundario
style={{ background: '#16a34a', color: '#fff' }}        // éxito / enviar
style={{ background: '#9f1239', color: '#fff' }}        // peligro / eliminar
```

### CSS global — texto en botones dentro de cards
La regla `button { white-space: nowrap }` rompe el texto en cards flex. Fix:
```tsx
style={{ whiteSpace: 'normal', overflow: 'hidden' }}
```

### Outbox — fase CIERRE
Los mensajes de cierre se almacenan con `phase='CIERRE'` en `OutboxMessage`. Esto es válido porque el campo es `String` en Prisma (no enum). El mecanismo de refresh antes de enviar lo ignora correctamente (devuelve `null`).

### Build de API
El build de `apps/api` (`tsc -p tsconfig.json`) puede tardar o fallar en entornos lentos. El stack corre desde el shadow build en `/home/uvan/seguimiento-api-run-20260307` cuando el build local falla.

### Build de web-v2
La página `/analitica-moodle` falla durante `next build` (error pre-existente de módulo faltante). No afecta el dev server ni las demás páginas.

---

## Cambios realizados (sesión 14 de abril de 2026)

### 9. Automatización de matrícula Banner (SFAALST) — estudiantes únicos

**Contexto:** El sistema solo tenía `rawJson.row.inscritos` por NRC (conteo agregado, no único). El banner-runner ya tenía el comando `roster` que consulta SFAALST y extrae una fila por estudiante con `institutionalId`. Se integró este flujo al API y al frontend.

**Archivos modificados:**
- `apps/api/src/modules/banner-people-sync/banner-people-sync.service.ts`
- `apps/api/src/modules/banner-people-sync/banner-people-sync.controller.ts`
- `apps/api/src/modules/banner-people-sync/banner-people-sync.module.ts`
- `web-v2/app/_features/reportes/cierre-panel.tsx`

**Nuevos endpoints API:**

```
POST /integrations/banner-people/roster-sync
Body: { periodCode: string, moment?: string, limit?: number }
Respuesta: { ok, roster: { nrcsQueried, foundCourses, emptyCourses, failedCourses, totalStudentRows }, import: {...}, uniqueStudents, totalRows }

GET /integrations/banner-people/unique-students?periodCode=202615
Respuesta: { periodCode, uniqueStudents, totalRows }
```

**Flujo técnico:**
1. Obtiene NRCs del periodo desde Prisma
2. Genera CSV temporal en `storage/runtime/banner/roster-sync/`
3. Ejecuta `banner-docente-nrc roster` via `execFile` (mismo patrón que `spaiden-batch`)
4. Importa el CSV a `BannerEnrollmentReport` + `BannerEnrollmentRecord` via `MoodleAnalyticsService.importBannerEnrollment`
5. Consulta `COUNT(DISTINCT institutionalId)` para el periodo

**Dependencia:** `BannerPeopleSyncModule` ahora importa `MoodleAnalyticsModule`.

### 10. Descarga de listado CSV de docentes insatisfactorios

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

Se agregó el botón **"Descargar listado CSV"** (gris oscuro) en la sección 6 (Insatisfactorios), junto a los botones ya existentes.

**Archivo generado:** `INSATISFACTORIOS_M{momento}_{periodo}.csv`

**Columnas del CSV:**
`Docente, Email, Coordinacion, Campus, NRCs, Alistamiento, Ejecucion, Total, Deficit`

Ordenado de menor a mayor puntaje. Incluye BOM UTF-8 para que Excel lo abra correctamente con tildes y caracteres especiales.

También se renombró "Descargar todos" → "Descargar planes HTML (N)" para diferenciar los dos tipos de descarga.

### 11. Panel de docentes — descarga de lista y CSV unificado

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

**Cambios:**

1. **Botón "Descargar lista CSV"** en sección 1 (tabla de docentes): genera `docentes_YYYY-MM-DD.csv` con columnas `id, cedula, nombre, correo, sede, region, centrocosto, coordinacion`. Incluye BOM UTF-8.

2. **Secciones 3 y 4 fusionadas** en "3) Importar docentes y coordinadores":
   - Opción A — CSV unificado
   - Opción B — Excel maestro (.xlsx)

3. **CSV unificado** (Opción A): un solo archivo CSV puede contener docentes y coordinadores. Columna `tipo` distingue: `DOCENTE` (por defecto si se omite) o `COORDINADOR`.

   **Columnas del CSV:**
   ```
   tipo,id,cedula,nombre,correo,sede,region,centrocosto,coordinacion,programa_id
   DOCENTE,12345,1001234567,Juan García,jgarcia@uni.edu,Bogotá,Centro,CC001,Ing. Sistemas,
   COORDINADOR,,,María López,mlopez@uni.edu,Bogotá,,,Ing. Sistemas,INJ
   ```

   **Lógica frontend:**
   - Filas DOCENTE → se agrupan y se envían a `POST /teachers/import-csv` como archivo
   - Filas COORDINADOR → se envían individualmente a `POST /coordinators` (requieren `programa_id`, `nombre`, `correo`)
   - Sin cambios en el backend

**UI:** Nueva sección "Estudiantes únicos — Banner (SFAALST)" al inicio del panel `/reportes`.

**Advertencias:**
- Para 202615 (1,252 NRCs) puede tardar ~1.5 horas — el timeout HTTP del browser puede expirar
- Requiere credenciales Banner en `tools/banner-runner/.env` y sesión activa

---

### 12. Fix — Límite máximo en consulta de docentes

**Problema:** Al ingresar un límite mayor a 500 (e.g. 520) en la tabla de docentes, la API rechazaba la petición silenciosamente y la tabla se mantenía en los resultados anteriores (150).

**Causa:** `TeachersQuerySchema` en `apps/api/src/modules/teachers/teachers.service.ts` tenía `max(500)`.

**Fix:**
- `apps/api/src/modules/teachers/teachers.service.ts` línea 13: `max(500)` → `max(5000)`

**Rebuild manual necesario:** el build automático de `stack:up` tiene timeout de 45s (tsc tarda más en Windows/WSL). Se construyó manualmente con `npx tsc` y se sincronizó al shadow dir.

---

### 13. Soporte de múltiples correos por docente (email2)

**Motivación:** Algunos docentes tienen dos correos: uno administrativo (`.edu`) y uno académico (`.edu.co`). Se necesita que los envíos lleguen a ambos.

**Cambios en base de datos:**
- `apps/api/prisma/schema.prisma`: añadido campo `email2 String?` al modelo `Teacher`
- Migración aplicada vía `prisma db push`

**Cambios en API (`apps/api`):**
- `teachers.service.ts`: `UpsertTeacherSchema` incluye `email2`; `upsertOne()` y `importCsv()` persisten `email2`; búsqueda por `email2` en `list()`; nuevo `EMAIL2_KEYS = ['email2','correo2','correo_admin',...]`
- `outbox.service.ts`: nuevo helper `teacherRecipientEmail(teacher)` que devuelve `email;email2` separados por `;` si ambos existen. Todos los `recipientEmail: teacher.email` reemplazados por el helper. La comprobación `if (!teacher.email)` ahora verifica ambos campos.

**Cambios en UI (`web-v2`):**
- `teachers-management-panel.tsx`: tipo `TeacherItem` y `ManualTeacherForm` incluyen `email2`; columna "Correo(s)" muestra ambos emails; formulario tiene campo "Correo 2 (admin)"; CSV de descarga incluye columna `correo2`; plantilla CSV actualizada con ejemplo; importación unificada pasa `correo2` al endpoint.

---

### 14. Fix — Corrupción catálogo Postgres (`pg_attribute`) + columna `email2`

**Problema:** La columna `email2` no existía físicamente en la tabla `Teacher` aunque Prisma la conocía. Todo `ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS email2 TEXT` fallaba con `duplicate key value violates unique constraint "pg_attribute_relid_attnam_index"` — entrada huérfana en el catálogo del sistema.

**Síntomas:** `The column Teacher.email2 does not exist in the current database` en importación CSV, listado global de NRC, y cualquier query que tocara Teacher con email2.

**Causa raíz:** Corrupción en `pg_attribute_relid_attnam_index` de `seguimiento-postgres-1` (entrada índice sin heap tuple correspondiente). VACUUM y REINDEX no la resolvieron.

**Fix:**
1. `pg_dump` de la base de datos completa → `/tmp/seguimiento_backup.sql` (510 docentes, 20 tablas)
2. `docker stop && docker rm` de ambos contenedores postgres (`seguimiento-postgres-1` e `infra-postgres-1`)
3. `docker volume rm infra_pgdata` — elimina el volumen corrupto
4. Nuevo contenedor `seguimiento-postgres-1` con volumen `infra_pgdata` limpio
5. Restauración del backup: `docker exec -i seguimiento-postgres-1 psql ... < backup.sql`
6. `ALTER TABLE "Teacher" ADD COLUMN IF NOT EXISTS email2 TEXT` — exitoso en DB limpia
7. Eliminado `seguimiento-postgres-1` (standalone), dejando `infra-postgres-1` gestionado por compose como única instancia postgres

**Fix de estabilidad del stack (`scripts/dev-stack.sh`):**
- `configure_runtime_ports`: si el compose service ya está running, no re-ejecuta `resolve_host_port` (evita port churn en Docker Desktop + WSL2 donde `host_port_accepts_connections` falla intermitentemente)
- `start_infra_service`: verifica por estado del contenedor docker compose antes de hacer check TCP (más fiable)

**Fix de `infra/docker-compose.yml`:**
- Volumen `pgdata` marcado como `external: true, name: infra_pgdata` para evitar advertencias de compose sobre volumen no gestionado

**Fix de dist corrompido:**
- `import.controller.js` en shadow dir tenía 1 línea (rsync parcial). Re-sincronizado con `rsync --checksum`

---

## Próximos reportes planificados (en UI)

| Reporte | Estado | Descripción |
|---|---|---|
| Cierre de Semestre | Ejemplo HTML listo | Consolidado M1+M2, evolución, podio de mejores |
| Informe Anual | Ejemplo HTML listo | Comparativa dos semestres, tendencias |
| Reporte de Tendencias | Próximamente | Evolución histórica por docente/coordinación |
| Reporte de Riesgo | Próximamente | Docentes críticos en múltiples momentos |

---

## Cambios realizados (sesión 15 de abril de 2026)

### 15. Fix — Puertos incorrectos en `apps/api/.env`

**Problema:** La API arrancaba pero caía inmediatamente (`ELIFECYCLE`) porque `apps/api/.env` tenía puertos de un entorno diferente. Esto hacía que `ConfigModule` sobreescribiera los valores correctos inyectados por `dev-stack.sh`.

**Puertos incorrectos → correctos:**
| Variable | Antes | Después |
|---|---|---|
| `DATABASE_URL` | `...127.0.0.1:5433/...` | `...127.0.0.1:25433/...` |
| `REDIS_URL` | `redis://127.0.0.1:16380` | `redis://127.0.0.1:36380` |

**Archivos corregidos:**
- `apps/api/.env`
- `/home/uvan/seguimiento-api-run-20260307/.env` (shadow build dir en WSL)

---

### 16. UI: "Limpiar base — conservar solo docentes del lote Banner actual"

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

Nueva sección **2.8** en el panel de docentes. Permite conservar solo los docentes del último lote Banner sincronizado y eliminar el resto.

**Flujo:**
1. **Analizar** → `GET /teachers/banner-keep` → devuelve `toKeep` y `toDelete` con preview
2. Se muestra una tabla previa con los docentes que serán eliminados (con aviso de cantidad)
3. **Aplicar limpieza** → `POST /teachers/keep-only` → elimina los docentes que no están en el lote Banner

---

### 17. Endpoint + UI — Eliminar todos los docentes

**Contexto:** Se necesita un flujo "clean-slate": borrar toda la tabla de docentes para reimportar desde cero cruzando con un Excel externo.

**Endpoint nuevo:**
```
POST /teachers/delete-all
Body: { confirm: true }   // campo obligatorio para evitar ejecuciones accidentales
Respuesta: { ok, deletedTeachers, unlinkedCourses }
```

**Lógica del servicio (`teachers.service.ts`):**
1. `course.updateMany({ where: { teacherId: { not: null } }, data: { teacherId: null } })` — desvincula cursos
2. `sampleGroup.deleteMany({})` — elimina todos los grupos de muestreo
3. `outboxMessage.deleteMany({ where: { NOT: { teacherId: null } } })` — limpia mensajes vinculados a docentes
4. `teacher.deleteMany({})` — elimina todos los docentes

**UI:** Botón rojo "Eliminar todos los docentes" (con `window.confirm()` de doble confirmación) junto al botón "Descargar lista CSV" en la sección de tabla de docentes.

**Archivos modificados:**
- `apps/api/src/modules/teachers/teachers.service.ts` — método `deleteAll()`
- `apps/api/src/modules/teachers/teachers.controller.ts` — `POST /teachers/delete-all`
- `web-v2/app/_features/docentes/teachers-management-panel.tsx` — estado `deletingAll`, función `deleteAllTeachers()`, botón rojo

**Notas de Prisma:** `SampleGroup.teacherId` es `String` (no nullable), por eso se usa `deleteMany({})` sin filtro. `OutboxMessage.teacherId` es `String?` (nullable), por eso se usa `{ NOT: { teacherId: null } }`.

---

### 18. Fix — Exclusión de NRCs NO_MATRICULADO del puntaje y lista de cursos

**Contexto:** Algunos docentes insatisfactorios tenían NRCs marcados como `reviewExcluded: true` con razón `NO_MATRICULADO` (el revisor Moodle no estaba matriculado en ese aula). Esos NRCs sin datos válidos inflaban el denominador del promedio y reducían el puntaje artificialmente.

**Cambio en `cierre-panel.tsx`:**

Antes: los cursos excluidos (`reviewExcluded: true`) eran ignorados solo en el puntaje pero seguían apareciendo en la lista de cursos del docente.

Después: si `c.reviewExcluded === true`, el curso **no se agrega** a `entry.courses` (no aparece en el panel) y tampoco suma al score ni al contador de cursos válidos (`scorableCount`).

Adicionalmente, si tras filtrar un docente queda con `entry.courses.length === 0` (todos sus NRCs eran NO_MATRICULADO), el docente se elimina del mapa de resultados y no aparece en el listado de insatisfactorios.

**Campo añadido al tipo `CourseItem`:**
```typescript
reviewExcluded?: boolean
reviewExcludedReason?: string | null
```
Estos valores se leen desde `rawJson.reviewerEnrollment.status === 'NO_MATRICULADO'` en el API.

**Impacto medido (periodo 202611, Momento 1):**
- Antes: 19 docentes insatisfactorios
- Después: 18 docentes insatisfactorios
- IVAN CABRERA RINCON D. salió del listado porque ambos sus NRCs eran NO_MATRICULADO — sin cursos válidos, no se puede calcular puntaje

**Archivos modificados:**
- `web-v2/app/_features/reportes/cierre-panel.tsx`

---

---

## Cambios realizados (sesión 16–17 de abril de 2026)

### 19. Reportes de Cierre — destinatarios extra persistentes en Sección 5 (Directivos)

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

Se agregó la opción **"+ Agregar destinatario"** en la sección 5 (Reportes para Directivos), con persistencia en `localStorage`.

**Funcionalidad:**
- Estado `extraDirectivosRecipients` inicializado desde `localStorage.getItem('directivos-extra-recipients')`
- `useEffect` persiste los cambios al storage automáticamente
- Cada destinatario extra tiene `label` (nombre visible) y `email`
- Botón "Eliminar" individual por destinatario
- Los destinatarios extra reciben copia del reporte ejecutivo junto a Subdirección / Dirección / Vicerrectoría

---

### 20. Reportes de Cierre — botón Enviar individual por docente (Sección 3)

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

Se agregó un botón **"Enviar"** individual por fila en la tabla de docentes (sección 3. Reportes para Docentes).

**Estado nuevo:** `sendingTeacherReport: Record<string, boolean>` — rastrea si cada docente está siendo procesado.

---

### 21. Fix — Coordinadores incorrectos asignados a programas

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

**Problema:** El algoritmo `slice(0, 12)` para cruzar `programCode` con `Coordinator.programId` producía falsos positivos. Por ejemplo, todos los programas de "Administración X" compartían los mismos primeros 12 caracteres normalizados.

**Causa raíz:** Comparación demasiado corta — 12 caracteres no son suficientes para distinguir programas con nombres largos similares.

**Solución — función `findCoordinator()`:**
```ts
function findCoordinator(coord: string, cs: Coordinator[]): Coordinator | undefined {
  const ck = normKey(coord);
  // 1. Coincidencia exacta
  const exact = cs.find(c => normKey(c.programId) === ck);
  if (exact) return exact;
  // 2. programId es prefijo del código del curso — gana el más largo
  const starts = cs
    .filter(c => { const pk = normKey(c.programId); return pk.length >= 8 && ck.startsWith(pk); })
    .sort((a, b) => normKey(b.programId).length - normKey(a.programId).length);
  if (starts.length) return starts[0];
  // 3. Prefijo inverso (tolerancia)
  const rev = cs
    .filter(c => { const pk = normKey(c.programId); return pk.length >= 8 && pk.startsWith(ck); })
    .sort((a, b) => normKey(a.programId).length - normKey(b.programId).length);
  return rev[0];
}
```

Se reemplazaron las 5 ocurrencias del algoritmo anterior por llamadas a esta función.

---

### 22. Reportes de Cierre — botón Enviar individual por coordinación (convocatoria)

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

Se agregó botón **"Enviar"** individual por cada fila en el preview de convocatoria (sección de coordinaciones).

**Estado nuevo:** `sendingConvocatoriaCoord: Record<string, boolean>`

---

### 23. Fix — Eliminar docente no refrescaba la lista en /docentes

**Archivos:**
- `apps/api/src/modules/teachers/teachers.controller.ts` — nuevo endpoint `DELETE /teachers/:id`
- `apps/api/src/modules/teachers/teachers.service.ts` — nuevo método `deleteOne(id)`
- `web-v2/app/_features/docentes/teachers-management-panel.tsx` — callback `onDelete` dispara `loadTeachers()`

**Lógica del servicio `deleteOne()`:**
1. `course.updateMany({ where: { teacherId: id }, data: { teacherId: null } })` — desvincula cursos
2. `outboxMessage.deleteMany({ where: { teacherId: id } })` — limpia mensajes
3. `sampleGroup.deleteMany({ where: { teacherId: id } })` — elimina grupos de muestreo
4. `teacher.delete({ where: { id } })` — elimina el docente

---

### 24. Fix — Puntaje NRC no se actualizaba en nrc-global-panel tras guardar

**Archivo:** `web-v2/app/_features/nrc/nrc-global-panel.tsx`

**Problema:** Al guardar una calificación, el formulario de edición no mostraba el nuevo valor. Había que recargar la página.

**Causa raíz:** `setOverrideById` tenía un guard `if (previous[courseId]) return previous` que bloqueaba la actualización si ya existía el estado (primera carga inicializaba el estado, pero el guard impedía actualizaciones posteriores).

**Fix:** Se eliminó el guard. Ahora siempre se actualiza con los valores confirmados por el servidor, preservando la fase seleccionada.

---

### 25. Fix — GET /review/queue retornaba HTTP 404

**Causa raíz:** El controller `review.controller.ts` y el endpoint `GET /review/queue` no existían.

**Archivos creados/modificados:**
- `apps/api/src/modules/review.controller.ts` — nuevo controller con inyección de `PrismaService` global
- `apps/api/src/modules/app.module.ts` — registrado `ReviewController` en `controllers: [HealthController, ReviewController]`

**Endpoint:**
```
GET /review/queue?periodCode=202615&moment=MD2&phase=EJECUCION
Respuesta: { ok, periodCode, phase, moment, total, done, pending, items }
```

Cada item incluye: `sampleGroupId`, `teacherName`, `programCode`, `modality`, `moment`, `template`, `done`, `selectedCourse: { id, nrc, subjectName, bannerStartDate, bannerEndDate, moodleCourseUrl }`

---

### 26. NRC Globales — momento RPACA y sourceId del docente en tabla

**Archivo:** `web-v2/app/_features/nrc/nrc-global-panel.tsx`

**Cambios visuales en la tabla:**
- Nueva columna **Momento**: valores `RY1`, `RY2`, `RYC` se muestran con badge ámbar; otros valores en texto plano
- Columna **Docente**: debajo del nombre aparece `sourceId` (o `documentId`) en fuente monospace gris

---

### 27. Fix — CSS roto en Analítica Moodle (causa raíz: variables CSS indefinidas)

**Problema:** Los botones de la página `/analitica-moodle` no tenían color. El panel usa `<style jsx>` con variables como `var(--teal)`, `var(--slate-700)`, `var(--accent)`, pero el rediseño v4 del sistema renombró la paleta a `--primary` y `--n-*`. Las variables antiguas quedaron sin definir en `:root`.

**Fix en `web-v2/app/globals.css`:**
Se agregaron aliases en `:root`:
```css
--teal:       var(--primary);
--teal-dark:  var(--primary-dark);
--teal-light: var(--primary-light);
--accent:     var(--primary);
--slate-50:   var(--n-50);
--slate-100:  var(--n-100);
/* ... hasta --slate-800 */
```

---

### 28. Analítica Moodle — simplificación del hero y tablas con scroll

**Archivo:** `web-v2/app/_features/moodle-analytics/moodle-analytics-panel.tsx`

**Hero:** Reducido de 6 botones a 2–3:
- Se conservan: "Actualizar todo Moodle" (primary), "Refrescar indicadores" (ghost)
- "Cancelar corrida" solo aparece si hay un proceso activo (`sidecarStatus?.running`)
- Los botones "Solo participantes / actividad / asistencia" se movieron al panel de selección de periodos como botones ghost con más contexto

**Tablas con scroll:** Las tablas de "Cursos a revisar", "Usuarios a revisar" e "Inasistencia por curso" ahora están envueltas en `.table-wrap` con `max-height: 340px` y scroll vertical.

---

### 29. Rediseño visual del Panel Operativo (ops-studio) para usuarios no técnicos

**Archivo:** `web-v2/app/ops-studio.tsx`

Sin cambiar ninguna función, handler o lógica — solo renombramientos y mejoras de presentación:

**Cambios de nombres principales:**
| Antes | Después |
|---|---|
| "Ops Studio" | "Panel operativo" |
| "Operaciones / Acciones sobre cola, sidecar y Banner" | "Herramientas del sistema / Procesos automáticos" |
| "Cola Moodle" | "Verificar aulas en Moodle" |
| "Sidecar Moodle" | "Clasificar aulas Moodle" |
| "Banner docente" | "Consultar docente en Banner" |
| "Modulos avanzados" | "Ir a otras secciones" |
| "Atencion prioritaria" | "Avisos de atención" |
| "Sidecar — muestra reciente" | "Últimas aulas clasificadas" |
| "Outbox borrador" | "Correos pendientes" |
| "Explorador de cursos" | "Listado de cursos" |
| "Ficha integrada / API + Banner + sidecar" | "Detalle del curso / Moodle · Banner · Revisión" |
| "Integracion Moodle/Banner" | "Estado en Moodle / Datos de Banner" |
| "Revision y muestreo" | "Estado de revisión" |
| "Control Sidecar" | "Clasificador de aulas Moodle" |
| "Control Banner" | "Consultas a Banner" |
| "Centro de archivos" | "Archivos del sistema" |
| Opciones select: `lookup/batch/retry-errors` | `NRC individual / Lote desde CSV / Reintentar fallidos` |
| Opciones sidecar: `classify/revalidate/backup/gui` | `Clasificar aulas / Revalidar / Crear respaldo / Modo manual` |
| `dry run` | "Solo simular (sin guardar)" |
| `resume` | "Continuar desde donde quedó" |
| `Workers` | "Navegadores paralelos / Hilos paralelos" |

**Nuevas funcionalidades visuales:**
- Cada acción colapsable tiene una **descripción en texto plano** (`.disclosure-desc`) explicando qué hace
- La sección "Ir a otras secciones" muestra **tarjetas `.module-card`** con título + descripción (antes eran botones genéricos sin contexto)
- Las tarjetas están expandidas por defecto

**CSS nuevo en `globals.css`:**
```css
.module-cards   /* grid de tarjetas de módulos */
.module-card    /* tarjeta individual con hover indigo */
.disclosure-desc /* párrafo descriptivo en disclosures */
```

---

---

### 30. Tema claro institucional — sidebar, hero y barra móvil

**Archivo:** `web-v2/app/globals.css`

El usuario rechazó el tema oscuro (`#16181d`). Se aplicó paleta clara institucional en todos los elementos de chrome del layout:

**Sidebar:**
- Fondo: `#ffffff` con borde derecho `var(--line)`
- Nombre de la app: `color: var(--primary)` (antes `#fff`)
- Links del menú: `var(--n-600)`, hover `var(--n-50)` / `var(--n-900)`
- Link activo: fondo `var(--primary-muted)`, texto `var(--primary)`
- Separadores con `var(--line)` en vez de `rgba(255,255,255,...)`

**Hero (cabecera de cada panel):**
- Fondo: `#ffffff`
- Borde superior: `3px solid var(--primary)` — acento institucional
- Texto: `var(--n-900)` (antes `#fff`)
- `.eyebrow`: color cambiado a `var(--primary-dark)` para contraste en fondo claro

**Barra móvil:** misma paleta clara; nombre en `var(--primary)`, hamburguesa con `var(--n-700)`.

El bloque `.log-block` (terminal de logs) se conservó oscuro — convención estándar.

---

### 31. Paleta universitaria (azul naval) + layout full-width

**Archivo:** `web-v2/app/globals.css`

**Paleta cambiada de índigo a azul naval institucional:**

| Variable | Antes (índigo) | Después (naval) |
|---|---|---|
| `--primary` | `#6366f1` | `#1b3a6b` |
| `--primary-dark` | `#4f46e5` | `#122850` |
| `--primary-dim` | `#818cf8` | `#4a72aa` |
| `--primary-light` | `#eef2ff` | `#e8edf7` |
| `--primary-muted` | `rgba(99,102,241,0.12)` | `rgba(27,58,107,0.08)` |
| `--bg` | `#f0f2f5` | `#eef2f7` |

Nuevo acento secundario dorado: `--gold: #b8841a` / `--gold-light: #fef5e4` (uso futuro en badges).

**Full-width:** `.shell` pasó de `max-width: 1540px` a `width: 100%` — el contenido ahora ocupa el 100% del espacio disponible después del sidebar.

---

### 32. NRC Globales — expansión múltiple simultánea

**Archivo:** `web-v2/app/_features/nrc/nrc-global-panel.tsx`

**Problema:** Solo se podía ver el detalle de un NRC a la vez. Al abrir uno nuevo se cerraba el anterior.

**Cambio:** Estado `expandedId: string | null` → `expandedIds: Set<string>`.

| | Antes | Después |
|---|---|---|
| Estado | un solo ID | Set de IDs |
| Comportamiento | clic en B cierra A | clic en B no afecta A |
| Detalle + formulario | uno a la vez | tantos como se necesiten |

Sin cambios en lógica de carga de detalle, calificación ni envío de correo.

---

### 33. Proxy Next.js eliminado — frontend llama directo a la API

**Archivo:** `web-v2/app/_lib/api.ts`

**Problema:** El proxy Next.js (`/api/backend/[...path]`) tardaba 10+ minutos en compilar en la primera petición porque Next.js corre en WSL sobre filesystem Windows (`/mnt/c/...`) donde inotify no funciona y la compilación es extremadamente lenta.

**Fix:** Se cambió `CLIENT_API_BASE` de `/api/backend` a `http://localhost:3001` directo. Posible porque la API ya tiene `cors: true` en el bootstrap de NestJS (`main.ts`).

```ts
// Antes
export const CLIENT_API_BASE = '/api/backend';

// Después
export const CLIENT_API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';
```

La variable de entorno `NEXT_PUBLIC_API_BASE_URL` permite sobreescribir en producción/staging sin tocar código.

---

### 34. NRC Globales — edición de Momento desde el detalle expandido

**Problema:** Un NRC aparecía con momento incorrecto (ej. MD1 cuando era MD2) y no había forma de corregirlo desde la UI.

**Backend — nuevo endpoint:**
- `PATCH /courses/:id/moment` en `CoursesController`
- Método `updateMoment(id, body)` en `CoursesService`
- Valida y normaliza con `normalizeMoment()` (mismo normalizador del sistema)

**Frontend — UI en la fila expandida (`nrc-global-panel.tsx`):**
- Campo de solo lectura "Momento actual"
- Input "Nuevo momento" (se convierte a mayúsculas automáticamente)
- Botón "Cambiar momento" que llama al endpoint y actualiza la tabla en memoria sin recargar

Estados nuevos: `momentEditById: Record<string, string>`, `savingMomentById: Record<string, boolean>`.

---

### 35. Reportes — descarga PDF para Docentes con Resultado Insatisfactorio

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

**Problema:** Solo existía descarga en HTML. El usuario necesitaba PDF para compartir por correo y Teams.

**Solución:** Se usa `window.open()` + `window.print()` del navegador — sin librerías externas. El usuario selecciona "Guardar como PDF" en el diálogo de impresión del navegador. El CSS ya tenía `@media print` con estilos limpios.

**Funciones nuevas:**
- `printAsPdf(html)` — abre HTML en ventana nueva y dispara `window.print()` con delay de 500ms
- `buildCombinedInsatisfactorioPdf(list)` — combina todos los planes en un solo documento con `page-break-after: always` entre cada `.shell`

**Botones agregados en sección 6:**
- Barra de controles: **"Descargar todos como PDF (N)"** — un solo diálogo de impresión para todos los planes combinados
- Cada fila: botón **"HTML"** (antes "Descargar") + botón **"PDF"** nuevo (abre ese plan individual listo para imprimir)

---

---

## Cambios realizados (sesión 21 de abril de 2026)

### 36. Reportes — botón Enviar individual por coordinación (Sección 4)

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

**Problema:** La sección 4 (Reportes para Coordinaciones) solo tenía un botón global "Enviar por correo (N con coordinador)". El usuario necesitaba poder enviar el reporte de cada coordinación de manera individual.

**Cambio:**

Estado nuevo: `sendingCoordId: string | null` — rastrea cuál coordinación está siendo enviada actualmente para mostrar "Enviando..." solo en ese botón.

Botón **"Enviar"** individual añadido en cada fila de la tabla:
- Verde (`#16a34a`) si hay coordinador registrado con correo
- Gris (`#9ca3af`, deshabilitado) si no hay coordinador registrado
- Muestra "Enviando..." mientras procesa
- Llama a `queueAndSend('COORDINADOR', [{ recipientName, recipientEmail, coordinatorId, subject, htmlBody }])` con los datos de esa coordinación
- Muestra resultado en `sendResult` (éxito, omitido-duplicado, fallo)

---

### 37. Fix — "No se encontró el archivo de exportación de Banner" en sección 2.8

**Archivo:** `web-v2/app/api/teachers/banner-keep/route.ts`

**Problema:** El botón "Analizar (usar lote Banner actual)" en la sección 2.8 del panel de docentes devolvía error: "No se encontró el archivo de exportación de Banner." aunque los archivos CSV sí existían en `tools/banner-runner/storage/exports/`.

**Causa raíz:** La constante `SYSTEM_ROOT` usaba `path.resolve(process.cwd(), '..', '..')`, lo que desde `web-v2/` subía **dos** niveles y salía del monorepo.

**Fix:**
```ts
// Antes
const SYSTEM_ROOT = path.resolve(process.cwd(), '..', '..');

// Después
const SYSTEM_ROOT = path.resolve(process.cwd(), '..');
```

Un solo nivel arriba desde `web-v2/` llega correctamente a la raíz del monorepo donde existe `tools/banner-runner/storage/exports/`.

---

### 38. Corrección de bandas de calificación — umbral insatisfactorio de 55 a 69

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

**Motivo:** Los niveles de desempeño institucionales correctos son:

| Nivel | Rango |
|---|---|
| Desempeño Excelente | 91 a 100 |
| Desempeño Bueno | 80 a 90 |
| Desempeño Aceptable | 70 a 79 |
| Desempeño Insatisfactorio | 0 a 69 |

El sistema usaba umbrales incorrectos (Excelente ≥85, Bueno ≥70, Aceptable ≥55, Insatisfactorio <55).

**Cambios aplicados en todos los puntos del archivo:**

| Antes | Después |
|---|---|
| Excelente ≥ 85 | Excelente ≥ 91 |
| Bueno ≥ 70 y < 85 | Bueno ≥ 80 y < 91 |
| Aceptable ≥ 55 y < 70 | Aceptable ≥ 70 y < 80 |
| Insatisfactorio < 55 | Insatisfactorio < 70 |

Archivos y contextos actualizados:
- `getBand()` — función principal de banda por puntaje
- `buildCoordinatorReport()` — KPIs, textos "inferior a X puntos", déficit `70 - totalScore`
- `buildDirectivosReport()` — KPIs institucionales, tabla por coordinación (excC, insC)
- `buildInsatisfactorioReport()` — texto "mínimo requerido: 70"
- `buildCoordsInsatisfactorioReport()` — texto "inferior a 70 puntos"
- Filtros de envío: `sendInsatisfactorioReports()` → `e.totalScore < 70`
- Filtros de tabla sección 6: `activeInsatisfactorios`, `allInsatisfactorios` → `< 70`
- Estadísticas de `computeStats()` → `excelente/bueno/aceptable/insatisfactorio` con nuevos cortes
- Texto descriptivo sección 6: "inferior a 70 puntos"
- Cálculo CSV de déficit: `(70 - e.totalScore)`
- Constante de déficit en tabla sección 6: `deficit = 70 - totalScore`

---

---

## Cambios realizados (sesión 24-25 de abril de 2026)

### 39. Botón Enviar individual por coordinación (Sección 4 cierre)

**Archivo:** `web-v2/app/_features/reportes/cierre-panel.tsx`

Estado nuevo `sendingCoordId: string | null` rastrea coordinación en proceso. Botón verde por fila reusa `queueAndSend('COORDINADOR', [...])` con un solo item. Botón gris cuando coordinación no tiene coordinador con email registrado.

---

### 40. Fix — Ruta del banner-keep route

**Archivo:** `web-v2/app/api/teachers/banner-keep/route.ts`

`SYSTEM_ROOT` usaba `path.resolve(cwd, '..', '..')` desde `web-v2/`, salía del repo. Cambio a `path.resolve(cwd, '..')` para llegar a la raíz del monorepo donde existe `tools/banner-runner/storage/exports/`.

---

### 41. Botón "Mantenimiento de navegadores" en panel operativo

**Archivos:**
- `web-v2/app/api/system/kill-browsers/route.ts` — endpoint POST que ejecuta `pkill -f msedge|google-chrome|chromium` y elimina locks (`SingletonLock`, `SingletonSocket`, `SingletonCookie`) del perfil Edge del runner Banner
- `web-v2/app/ops-studio.tsx` — sección con dos pasos:
  1. **Limpiar navegadores colgados** (rojo) — termina procesos + elimina locks
  2. **1. Abrir login Banner** (naranja) → completa SSO/2FA → **2. Guardar sesión Banner** (verde, paso crítico)

Ambos botones de login reusan `/api/banner/actions` con actions `auth-start` y `auth-confirm`.

---

### 42. Fix — Sesión Banner no persistía para SPAIDEN

**Archivo:** `web-v2/app/_lib/banner-runner.ts` función `confirmBannerAuth()`

**Problema:** `/banner` guardaba la sesión en `storage/runtime/banner/auth-bridge/banner-storage-state.json`, pero el runner Banner SPAIDEN la buscaba en `tools/banner-runner/storage/auth/banner-storage-state.json`. Las dos ubicaciones no coincidían, por eso SPAIDEN volvía a pedir login.

**Solución:** tras confirmar sesión, copia el storageState al sitio que el runner espera:

```ts
const bridgeState = getBannerBridgeStorageStateFile();
const runnerState = path.join(getBannerProjectRoot(), 'storage', 'auth', 'banner-storage-state.json');
if (fs.existsSync(bridgeState)) {
  fs.mkdirSync(path.dirname(runnerState), { recursive: true });
  fs.copyFileSync(bridgeState, runnerState);
}
```

Resultado: tras un solo login, sesión queda disponible para todos los flujos (SPAIDEN, roster, lookup, batch).

---

### 43. Fix — Normalización de personId Banner: padding solo a IDs <8 dígitos

**Archivos:**
- `tools/banner-runner/src/cli.ts` — función `normalizeSpaidenPersonId()`
- `tools/banner-runner/src/banner/pages/SpaidenPage.ts`
- `tools/banner-runner/src/banner/backendMessageClient.ts` — función `normalizePersonId()`
- `apps/api/src/modules/banner-people-sync/banner-people-sync.service.ts` — función `normalizePersonId()`

**Problema:** la normalización paddeaba todos los IDs <9 dígitos a 9 con ceros. Pero Banner real espera:
- IDs de 6-7 dígitos → padded a 9 (ej. `1100818` → `001100818` ✅)
- IDs de 8-9 dígitos → **sin padding** (cédulas — ej. `93362731` se queda como `93362731` ✅)

**Fix:**
```ts
function normalizePersonId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return trimmed;
  if (trimmed.length >= 8) return trimmed; // cédulas, sin padding
  return trimmed.padStart(9, '0');         // IDs Banner cortos, padding a 9
}
```

**Resultado medido:** SPAIDEN antes del fix: 32/245 encontrados. Tras el fix: **245/245 encontrados** (nombres + correos completos).

---

### 44. Fix UI — Sección 0 docentes: dos pasos claros para sincronización SPAIDEN

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

Reescribió la sección "0) Traer nombres y correos desde Banner" con dos bloques visualmente diferenciados:
- **Paso 1:** "Vincular cédulas con Banner" — cruza con NRC resueltos
- **Paso 2:** "Traer nombre y correo desde Banner" — usa SPAIDEN

Resultados ahora se muestran en cuadro verde con conteos resaltados (✓ docentes actualizados, encontradas, no encontradas, fallos). Avisa cuántos quedaron omitidos por falta de ID.

---

### 45. Highlighting visual de campos faltantes + filtros multi en tabla docentes

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

**Highlighting:** celdas vacías marcadas con fondo `#fef2f2`, texto `#991b1b` itálico ("falta"). Cédula NO marcada (no es crítico).

**Filtros multi-select por chips clickeables:**
- Coordinación, Sede, Escalafón, Dedicación, Estado del docente
- Campos faltantes: sin correo, sin correo 2, sin sede, sin región, sin coordinación, sin centro costo, sin escalafón, sin contrato, sin fecha fin

Botón "Filtros" muestra contador `Filtros (N)` cuando hay activos. Botón "Limpiar filtros" aparece cuando hay alguno seleccionado.

---

### 46. Integración completa CSV docentes enriquecido (17 campos) con clasificación NUEVO/ANTIGUO

**Archivos modificados:**
- `apps/api/prisma/schema.prisma` — model Teacher: 8 campos nuevos (`escalafon`, `dedicacion`, `tipoContrato`, `fechaInicio: DateTime?`, `fechaFin: DateTime?`, `antiguedadText`, `programaAcademico`, `programaCodigo`)
- `apps/api/src/modules/teachers/teachers.service.ts` — `importCsv()` extendido con keys nuevos + parser de fechas (`parseDate()`)
- `web-v2/app/_features/docentes/teachers-management-panel.tsx` — nuevas helpers, columnas, filtros, modal

**Helpers agregados (frontend):**
- `classifyTeacher(fechaInicio)` → `NUEVO` | `ANTIGUO` | `SIN_CONTRATO`
  - NUEVO: contratado en el año actual
  - ANTIGUO: fecha_inicio en años anteriores
- `weeksSince(fechaInicio)` — semanas en la institución
- `daysUntilContractEnd(fechaFin)` — días hasta fin de contrato (negativo = vencido)
- `formatDate()`, `statusBadge()` para presentación

**Tabla rediseñada:**
- Columna **Estado** con badge NUEVO/ANTIGUO/SIN_CONTRATO + ID debajo
- Columna **Contrato** con alertas: rojo si vencido, amarillo si <30 días
- Subtítulos en gris bajo cada celda (cédula, región, código programa, fecha fin)

**Filtros nuevos:** Estado del docente, Escalafón, Dedicación.

**Modal "Ver ficha"** (botón `#0891b2` por fila):
- Header con gradiente `#1e3a8a → #1e40af`, badge estado + semanas en institución
- Grid 2 columnas: **Información general** (10 campos) + **Vinculación contractual** (6 campos con alertas visuales)
- **Política de evaluación dinámica:**
  - NUEVO insatisfactorio → "plan de inducción y acompañamiento (sin sanción). Pasa a ANTIGUO al cumplir ≥8 semanas + completar un momento."
  - ANTIGUO insatisfactorio → "se genera evento significativo en hoja de vida."
  - SIN_CONTRATO → "completar fecha de inicio para clasificar."

**Resultado:** 245 docentes importados con datos completos. CSV de origen: `C:/Users/Duvan/Downloads/docentes_enriquecido.csv` (17 columnas).

---

---

## Sesión 25 de abril de 2026 (continuación) — Reorganización UI docentes + push GitHub

### 47. Soporte para docentes que regresan a la institución

**Problema:** Un docente que ya trabajó antes en UNIMINUTO y regresa no debe contar como NUEVO. Necesita marcarse manualmente.

**Schema:** `apps/api/prisma/schema.prisma`
- Campo nuevo `previousEmployment Boolean @default(false)` en model Teacher

**API (`apps/api/src/modules/teachers/teachers.service.ts`):**
- `UpsertTeacherSchema` extendido con `previousEmployment: z.boolean().optional()` + 8 campos contractuales adicionales (escalafon, dedicacion, tipoContrato, fechaInicio, fechaFin, antiguedadText, programaAcademico, programaCodigo)
- `upsertOne()` ahora persiste todos estos campos en create + update
- Helper `parseDateLocal()` interno para procesar strings de fecha desde el form

**Frontend (`web-v2/app/_features/docentes/teachers-management-panel.tsx`):**
- `classifyTeacher(fechaInicio, previousEmployment)` actualizado: si `previousEmployment === true`, devuelve `ANTIGUO` desde el primer día sin importar la fecha de inicio.
- Tabla y modal usan ese flag al calcular el badge.
- Filtro por Estado del docente respeta la nueva lógica.

**Resultado:** docente regresado al sistema con flag activo aparece directamente como ANTIGUO. Política de evaluación correcta (insatisfactorio → evento significativo, no plan de inducción).

---

### 48. Match automático coordinador → docente en tabla y modal

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

Nuevas helpers globales:
- `normalizeMatchKey(value)` — normaliza string (sin tildes, sólo alfanumérico, mayúsculas)
- `findCoordinatorMatch(teacher, coordinators)` — cruza por:
  1. `programaCodigo` exacto
  2. `costCenter` exacto
  3. `coordination` con prefix-match en cualquier dirección

**UI:**
- Nueva columna **Coordinador** en la tabla principal entre Coordinación y Sede
  - Verde con nombre y correo si hay match
  - Amarillo con "sin coordinador" si no hay
- Modal "Ver ficha":
  - Bloque verde "Coordinador asignado" cuando hay match
  - Bloque amarillo de aviso cuando no hay coordinador para esa coordinación

---

### 49. Reorganización completa secciones del panel `/docentes`

**Problema:** Antes había 7 secciones (1, 1.1, 2, 2.1, 2.5, 2.8, 3) muchas con propósito similar — formulario manual permanentemente visible aunque no se use, secciones de mantenimiento mezcladas.

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

**Estructura nueva:**

| # | Sección | Comportamiento |
|---|---|---|
| 0) | Traer nombres y correos desde Banner | igual |
| 1) | Tabla de docentes | igual + filtros + columna coordinador |
| 1.1) | Tabla de coordinadores | igual |
| 2) | Agregar / Editar docente | **colapsable** — botón principal "+ Agregar docente nuevo" o muestra "Editando: NOMBRE" cuando hay edit en curso |
| 2.1) | Agregar / Editar coordinador | **colapsable** — mismo patrón |
| 3) | Importar y mantenimiento | **toggle único** que muestra/oculta 3.1 (depuración), 3.2 (limpiar lote Banner), 3.3 (importar CSV/Excel) |

**Estados nuevos:**
- `showTeacherForm`, `showCoordinatorForm`, `showMaintenance` — controlan visibilidad de cada bloque
- Al iniciar edición desde tabla o modal, el form se abre automáticamente
- Botón "Cancelar edición" rojo en modo edit

**Form expandido (sección 2):**

Tres bloques visualmente diferenciados con título azul institucional:

1. **Identidad** — id, sourceId, cédula, nombre, correo, correo2
2. **Ubicación y programa** — sede, región, centro costo, coordinación, programa académico, código programa
3. **Vinculación contractual** — escalafón (select), dedicación (select), tipo contrato (select), fecha inicio (date picker), fecha fin (date picker), antigüedad (texto libre)
4. **Historial (caja amarilla):** checkbox "Ya trabajó antes en UNIMINUTO (regreso a la institución)" con explicación

Botones al final: "Crear docente" / "Guardar cambios" según modo + Cancelar.

**Form coordinador (sección 2.1):** mismos campos previos pero ahora colapsable.

---

### 50. Botón "Editar este docente" en modal Ver ficha

**Archivo:** `web-v2/app/_features/docentes/teachers-management-panel.tsx`

El modal ahora tiene un botón al final que:
1. Carga todos los datos del docente al `form` state (incluidos los 9 campos nuevos)
2. Activa `editingTeacherId` y `showTeacherForm`
3. Cierra el modal
4. Hace `window.scrollTo` al inicio para que el usuario vea el formulario

Permite editar sin cerrar manualmente la ficha y buscar el botón "Editar" en la fila.

---

### 51. .gitignore actualizado y runtime files removidos del repo

**Archivo:** `.gitignore`

Líneas nuevas:
```
storage/runtime
.env.local
**/.env.local
```

**Removidos del index** (vía `git rm --cached`):
- `storage/runtime/dev-stack/api.log`, `web.log`, `worker.log`
- `storage/runtime/dev-stack/api.pid`, `web.pid`, `worker.pid`
- `storage/runtime/dev-stack/stack.env`
- `storage/runtime/banner/runner-config.json`
- `storage/outputs/banner-runs/runner-state.json`
- `web-v2/.env.local`

Estos archivos ahora son locales y nunca van al repo. Cada desarrollador genera los suyos al arrancar el stack.

---

### 52. Push a GitHub origin/main

**Commit:** `baa187a` — "feat: Banner SPAIDEN, datos enriquecidos docentes, mantenimiento UI"

**URL:** https://github.com/vmasterdev/seguimiento-aulas-system/commit/baa187a

Incluye toda la sesión: cambios #39-51.

---

## Estado actual del sistema (snapshot 25-abr-2026)

### Datos en BD
- 245 docentes con todos los campos contractuales
- 245/245 con nombre y correo desde Banner SPAIDEN
- IDs Banner correctamente vinculados
- Bandas calificación: 91-100/80-90/70-79/0-69

### Flujos operativos validados
1. Sincronización SPAIDEN end-to-end (login → guardar sesión → traer datos)
2. Limpieza de procesos Edge cuando perfil bloqueado
3. Importación CSV enriquecido con 17 columnas
4. Edición de cualquier campo de docente desde el panel
5. Reportes cierre con bandas correctas y envío individual/masivo
6. Detección automática NUEVO/ANTIGUO/SIN_CONTRATO
7. Match coordinador↔docente por programa

### Reglas institucionales codificadas
- **NUEVO:** contratado en año actual + nunca trabajó antes en UNIMINUTO
- **ANTIGUO:** fecha_inicio en años anteriores O `previousEmployment === true`
- **NUEVO insatisfactorio:** plan de inducción (sin sanción)
- **ANTIGUO insatisfactorio:** evento significativo en hoja de vida
- **Transición NUEVO → ANTIGUO:** ≥8 semanas en institución + completar un momento de evaluación

### Próximos pasos sugeridos para futura sesión / otra IA
- Implementar generación automática de "evento significativo" para ANTIGUOS insatisfactorios
- Crear vista de reporte cruzada Coordinación × Escalafón × Promedio
- Agregar alertas de fin de contrato a un dashboard ejecutivo
- KPI de retención M1 → M2 por coordinación
- Exportador de "lista de inducción" (NUEVOS sin haber pasado momento)
- Extensión navegador para búsqueda rápida de NRCs (planeada pero no implementada)

---

*Última actualización: 25 de abril de 2026 — Commit baa187a en origin/main*
