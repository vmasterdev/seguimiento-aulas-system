# seguimiento-aulas-system

Sistema de seguimiento de aulas virtuales para Moodle (UNIMINUTO) sin API institucional, con:

- Ingesta de programacion academica desde CSV (RPACA002v1 u hojas equivalentes).
- Clasificacion de aulas en Moodle por UI automation (Playwright + BullMQ).
- Muestreo deterministico por `Docente + Modalidad + Programa + Momento + TipoAula`.
- Motor de evaluacion para fases de Alistamiento y Ejecucion.
- Outbox para generar correos HTML y exportarlos a `.eml`.
- Dashboard web de monitoreo operativo.

## Stack

- `apps/api`: NestJS + Prisma (Postgres) + BullMQ
- `apps/worker`: Node + BullMQ + Playwright
- `apps/web`: Next.js
- `packages/shared`: validaciones y reglas compartidas (zod)
- `infra/docker-compose.yml`: Postgres + Redis

## Estructura

- `apps/api`: endpoints de negocio y persistencia
- `apps/worker`: consumo de cola `moodle.classify`
- `apps/web`: panel de seguimiento y estado del sistema
- `data/evidence`: evidencias de clasificacion Moodle (HTML/screenshot)
- `data/outbox`: archivos `.eml` exportados
- `docs`: PRD, arquitectura y criterios funcionales
- `storage/inputs`: archivos fuente operativos (CSV RPACA, excels de docentes y clasificacion)
- `storage/outputs`: archivos de salida (validaciones, pendientes, OK, faltantes)

## Organizacion de archivos (nuevo estandar)

- Entradas RPACA (CSV):
  - `storage/inputs/rpaca_csv/`
- Entradas maestras Excel (docentes/coordinadores):
  - `storage/inputs/reference_excels/`
- Entradas de clasificacion visual:
  - `storage/inputs/classification_excels/`
- Salidas de control/validacion:
  - `storage/outputs/validation/`
- Pendientes de URL final Moodle:
  - `storage/outputs/pending/`
- NRC consolidados OK con URL final:
  - `storage/outputs/ok/`
- Faltantes de tipo de aula:
  - `storage/outputs/gaps/`

## Requisitos

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

## Configuracion local

1. Levantar infraestructura:

```bash
docker compose -f infra/docker-compose.yml up -d
```

2. Instalar dependencias:

```bash
pnpm install
```

3. Configurar variables de entorno:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
```

4. Generar Prisma Client, migrar y seed:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:seed
```

5. Iniciar todo el sistema:

```bash
pnpm dev
```

Servicios por defecto:

- API: `http://localhost:3001`
- Web: `http://localhost:3000`
- Postgres: `localhost:5433`
- Redis: `localhost:6380`

Variable opcional para abrir Moodle desde revision manual:

- `NEXT_PUBLIC_MOODLE_URL_TEMPLATE`
  - Ejemplo: `https://campus.tuuniversidad.edu/course/search.php?search={nrc}`
  - Si no usas `{nrc}`, el sistema agrega `?search=<NRC>` automaticamente.

Nota de rendimiento:
- Si ejecutas el proyecto en WSL sobre rutas montadas de Windows (`/mnt/c/...`), el arranque puede ser mas lento. Para mejor rendimiento, usa un path Linux nativo (por ejemplo `~/proyectos/...`).

## Flujo operativo recomendado

1. Importar CSV de aulas
2. Importar base de docentes (`.xlsx`)
3. Encolar clasificacion Moodle (tambien resuelve y guarda URL del aula por NRC)
4. Ejecutar muestreo
5. Calcular evaluaciones
6. Generar outbox
7. Exportar `.eml`

## Endpoints principales

### Salud y estado

- `GET /health`
- `GET /stats/overview`
- `GET /queue/stats`

### Cursos y clasificacion

- `GET /courses?limit=100&offset=0&periodCode=202610&status=PENDIENTE`
- `GET /courses/:id`
- `PATCH /courses/:id/manual`

### Ingesta

- `POST /import/csv` (multipart/form-data, uno o varios CSV)
- `POST /import/teachers-xlsx` (multipart/form-data, archivo `.xlsx` de docentes y coordinadores)

### Cola

- `POST /queue/enqueue-classify`
- `POST /queue/retry`

### Muestreo

- `POST /sampling/generate`
- `GET /sampling?periodCode=202610`
- `GET /sampling/review-queue?periodCode=202615&phase=ALISTAMIENTO&moment=MD1`

### Scripts utiles

- `pnpm -C apps/api exec tsx scripts/import-visual-review.ts "<ruta_excel_visual>.xlsx"`
  - Sugerido: `storage/inputs/classification_excels/LISTADO_NRC_REVISADOS_VISUALMENTE_TIPO_AULA_CON_TITULO.xlsx`
- `pnpm -C apps/api exec tsx scripts/backfill-moodle-search-url.ts [periodCode]`
  - Precarga URL de busqueda Moodle por NRC y la guarda en la ficha (`moodleCourseUrl`).

### Evaluacion

- `POST /evaluation/score`
- `POST /evaluation/recalculate`
- `POST /evaluation/replicate-sampled`
- `GET /evaluation?periodCode=202610&phase=ALISTAMIENTO`

### Outbox

- `POST /outbox/generate`
- `POST /outbox/export-eml`
- `POST /outbox/send`
- `GET /outbox?periodCode=202610&status=DRAFT`

## Ejemplos de payload

### Encolar clasificacion

```json
{
  "periodCode": "202610",
  "limit": 300,
  "statuses": ["PENDIENTE"]
}
```

### Muestreo

```json
{
  "periodCode": "202610",
  "seed": "202610-MD1"
}
```

### Recalculo de evaluacion

```json
{
  "periodCode": "202610",
  "phase": "EJECUCION"
}
```

### Calificar y replicar al grupo muestreado

```json
{
  "courseId": "ID_DEL_CURSO_SELECCIONADO",
  "phase": "ALISTAMIENTO",
  "replicateToGroup": true,
  "checklist": {
    "plantilla": true,
    "asistencia": true,
    "presentacion": true,
    "actualizacion_actividades": true
  }
}
```

Nota:
- Para `INNOVAME` y `D4` en alistamiento manual, esos 4 items suman 50 puntos.
- Para `CRIBA`, se mantiene el esquema original:
  - `plantilla` 20
  - `fp` 5
  - `fn` 5
  - `asistencia` 10
  - componentes `criba_*` repartidos en 13 items para completar 10 puntos.

### Replicar desde todas las muestras del periodo

```json
{
  "periodCode": "202615",
  "phase": "ALISTAMIENTO",
  "moment": "MD1"
}
```

### Generar outbox

```json
{
  "periodCode": "202610",
  "phase": "ALISTAMIENTO",
  "moment": "MD1",
  "audience": "DOCENTE"
}
```

### Generar outbox para coordinadores

```json
{
  "periodCode": "202610",
  "phase": "ALISTAMIENTO",
  "moment": "MD1",
  "audience": "COORDINADOR"
}
```

### Enviar correos outbox (SMTP)

```json
{
  "periodCode": "202615",
  "phase": "ALISTAMIENTO",
  "moment": "MD1",
  "audience": "DOCENTE",
  "status": "DRAFT",
  "limit": 10,
  "forceTo": "tu-correo@dominio.edu",
  "dryRun": true
}
```

Notas:
- `dryRun: true` solo lista candidatos (no envía ni cambia estado).
- `dryRun: false` envía y marca cada mensaje exitoso como `SENT_AUTO`.
- `forceTo` (opcional) fuerza destinatario único para pruebas controladas (ej. 10 docentes a tu correo).

### Generar outbox global

```json
{
  "periodCode": "202610",
  "phase": "ALISTAMIENTO",
  "moment": "MD1",
  "audience": "GLOBAL"
}
```

## Notas del worker Moodle

- El worker puede buscar NRC por modalidad automaticamente usando:
  - `MOODLE_BASE_URL_PRESENCIAL`
  - `MOODLE_BASE_URL_DISTANCIA`
  - `MOODLE_BASE_URL_POSGRADOS`
  - `MOODLE_BASE_URL_MOOCS`
- La modalidad objetivo se infiere por periodo + modalidad + prefijo NRC, con fallback automatico.
- Para cada NRC encontrado se guarda en `MoodleCheck`:
  - `moodleCourseUrl`
  - `moodleCourseId`
  - `resolvedModality`
  - `resolvedBaseUrl`
  - `searchQuery`
- Si no hay credenciales validas, el worker entra en modo heuristico para no bloquear operacion.

## Mapeo RPACA (PARTE_PERIODO)

- `RY1` -> `MD1` (Momento 1)
- `RY2` -> `MD2` (Momento 2)
- `RYC` -> `1` (Semestral)
- `INM` -> `INTER`

## Reportes a coordinadores

- El Excel `COORDINADORES - DOCENTES_CENTROCOSTO_ZONAS S1.xlsx` se usa para cargar:
  - docentes (hojas `Docentes`, `CENTRO`, `SUR`)
  - coordinadores (hoja `Coordinadores`)
- El cruce de NRC -> coordinacion se hace por docente:
  - se toma `ID_DOCENTE` o `IDENTIFICACION` desde RPACA
  - se cruza contra `ID` o `CEDULA` del Excel de docentes
  - desde esa fila se toma `Responsable`/`CentroCosto` como coordinacion
  - la coordinacion se cruza con la hoja `Coordinadores` (`ID`, `Email`, `Nombre`)
- Al generar outbox con audiencia `COORDINADOR`, se crea 1 mensaje por coordinador/coordinacion con:
  - docentes de la coordinacion
  - NRC asignados
  - asignatura, momento y estado Moodle por NRC
- Los mismos tipos de reporte (docente, coordinacion/programa, global) pueden emitirse por:
  - `MD1` (`RY1`) en Alistamiento y Ejecucion
  - `MD2` (`RY2`) en Alistamiento y Ejecucion
  - `1` (`RYC`) en Alistamiento y Ejecucion
- Los estilos HTML de correo para docente/coordinacion se toman desde la carpeta `ejemplo_reportes`.
  - Variable opcional: `REPORT_TEMPLATES_DIR` (por defecto `../../ejemplo_reportes` desde `apps/api`).
- Para el reporte global (`audience: GLOBAL`) puedes definir destinatario por variables:
  - `OUTBOX_GLOBAL_RECIPIENT_EMAIL`
  - `OUTBOX_GLOBAL_RECIPIENT_NAME`
- Para envio SMTP (`POST /outbox/send`), configura en `apps/api/.env`:
  - `OUTBOX_SMTP_HOST`
  - `OUTBOX_SMTP_PORT`
  - `OUTBOX_SMTP_SECURE`
  - `OUTBOX_SMTP_REQUIRE_AUTH`
  - `OUTBOX_SMTP_USER`
  - `OUTBOX_SMTP_PASS`
  - `OUTBOX_SMTP_FROM`
  - `OUTBOX_SMTP_REPLY_TO` (opcional)
  - `OUTBOX_SMTP_IGNORE_TLS` (opcional)
  - `OUTBOX_SMTP_REJECT_UNAUTHORIZED` (opcional)
- Prueba local con Mailpit:
  - SMTP: `OUTBOX_SMTP_HOST=127.0.0.1`, `OUTBOX_SMTP_PORT=1025`
  - UI Mailpit: `http://localhost:8025`

## Documentacion funcional

- `docs/00_PRD.md`
- `docs/01_ARCHITECTURE.md`
- `docs/02_DATA_MODEL.md`
- `docs/03_RUBRICS.md`
- `docs/04_MOODLE_UI_AUTOMATION.md`
- `docs/05_EMAIL_OUTPUT.md`
- `docs/07_ACCEPTANCE_TESTS.md`
- `docs/08_STORAGE_ORGANIZATION.md`
- `docs/09_INTEGRATION_CONTRACT.md`
- `docs/10_PROMPT_OTRO_SISTEMA.md`

## Sidecar Moodle (Integracion)

Se agrego un modulo sidecar Python sin reemplazar la arquitectura principal.

Ruta:
- `tools/moodle-sidecar`

Config central:
- `storage/archive/system/moodle_sidecar.config.json`

Comandos rapidos:
- `pnpm sidecar:classify`
- `pnpm sidecar:revalidate`
- `pnpm sidecar:adapter:dry`
- `pnpm sidecar:adapter`
- `pnpm sidecar:backup`
- `pnpm sidecar:gui`

Modo solo integracion (sin reprocesar Moodle):
- `pnpm -C apps/api exec tsx scripts/moodle_url_resolver_adapter.ts "storage/inputs/classification_excels/LISTADO_NRC_REVISADOS_VISUALMENTE_TIPO_AULA_CON_TITULO.xlsx" --source=historico_visual`

Contrato adapter:
- `docs/SIDECAR_CONTRACT.md`
