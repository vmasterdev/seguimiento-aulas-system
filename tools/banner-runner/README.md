# Banner Docente por NRC

Proyecto independiente para consultar NRC en Banner, extraer datos del docente asignado y persistir resultados localmente sin tocar el sistema principal.

## 1. Estructura del proyecto

```text
.
├── config/
│   └── banner.profile.json
├── prisma/
│   └── schema.prisma
├── src/
│   ├── banner/
│   │   ├── pages/
│   │   │   ├── LoginPage.ts
│   │   │   └── NrcSearchPage.ts
│   │   ├── bannerClient.ts
│   │   ├── frameResolver.ts
│   │   └── selectors.ts
│   ├── config/
│   │   ├── bannerProfile.ts
│   │   └── env.ts
│   ├── core/
│   │   ├── errors.ts
│   │   └── types.ts
│   ├── db/
│   │   ├── prisma.ts
│   │   └── repositories/
│   ├── evidence/
│   │   └── evidenceService.ts
│   ├── export/
│   │   ├── csv.ts
│   │   └── exportService.ts
│   ├── input/
│   │   └── nrcInput.ts
│   ├── logging/
│   │   └── logger.ts
│   ├── services/
│   │   ├── batchService.ts
│   │   ├── lookupService.ts
│   │   └── retryService.ts
│   ├── storage/
│   │   └── fsPaths.ts
│   └── cli.ts
├── storage/
│   ├── evidence/
│   ├── exports/
│   └── logs/
└── tests/
```

## 2. Decisión de arquitectura

La arquitectura sigue una separación por capas:

- `CLI`: orquesta comandos y opciones.
- `Services`: flujo de negocio, reanudación, reintentos y persistencia de resultados.
- `Banner`: automatización Playwright con `page objects`, resolución de frames y selectores robustos.
- `Repositories`: acceso a Prisma sin mezclar SQL/ORM con la lógica de negocio.
- `Evidence` y `Export`: responsabilidades aisladas para auditoría y salida de datos.

Decisiones clave:

- Proyecto completamente aislado del sistema principal.
- Selectores externos en `config/banner.profile.json` para adaptar Banner sin reescribir lógica.
- Flujo de `SSASECT` soportado con acciones posteriores a la carga del formulario, por ejemplo `Instructores asignados`.
- Prisma con datasource configurable por variables de entorno para arrancar con SQLite y migrar luego a PostgreSQL.
- Prisma operativo con esquema activo SQLite y esquema alterno PostgreSQL listo para migracion.
- Persistencia por consulta (`banner_queries`), sesión (`banner_sessions`) y resultado (`banner_results`) para soportar auditoría, reanudación y exportación.
- Sesión Playwright reutilizada por lote para mejorar estabilidad y tiempos.

## 3. Módulos principales

- `src/config/env.ts`: variables de entorno y rutas.
- `src/config/bannerProfile.ts`: validación del perfil de selectores.
- `src/banner/pages/LoginPage.ts`: autenticación.
- `src/banner/pages/NrcSearchPage.ts`: navegación y búsqueda por NRC.
- `src/banner/frameResolver.ts`: soporte para frames anidados.
- `src/services/lookupService.ts`: ejecución unitaria, manejo de errores y evidencia.
- `src/services/batchService.ts`: lotes, reanudación y ciclo de consulta.
- `src/services/retryService.ts`: reintento de errores.
- `src/db/repositories/*`: persistencia con Prisma.
- `src/export/exportService.ts`: salida CSV y JSON.
- `src/evidence/evidenceService.ts`: screenshots y HTML de fallos.

## 4. Flujo de ejecución

1. El CLI carga `.env` y el perfil de Banner.
2. Inicializa Prisma, logger, rutas de storage y servicios.
3. Crea o reutiliza una `banner_query`.
4. Abre una sesión Playwright, inicia login y navega al módulo de búsqueda.
5. Consulta cada NRC.
6. Persiste resultado con estado `ENCONTRADO`, `SIN_DOCENTE`, `NO_ENCONTRADO` o `ERROR`.
7. Si falla una consulta, guarda evidencia.
8. Al final actualiza contadores, estado de la consulta y permite exportar o reintentar.

## 5. Riesgos técnicos

- Banner puede usar frames, tablas dinámicas o navegación legacy no observable sin ajustar el perfil de selectores.
- Algunos campos podrían aparecer solo tras acciones intermedias no modeladas todavía si el flujo real es más complejo.
- Si Banner tiene mecanismos anti-bot, captcha o SSO federado, hará falta una adaptación específica.
- La primera versión depende de conocer y afinar el DOM real para marcar selectores definitivos.
- `retry-errors` reutiliza la misma infraestructura de lote; conviene validar con datos reales si Banner invalida sesiones largas.

## 6. Plan de implementación por fases

### Fase 1

- Base del proyecto.
- CLI.
- Prisma + SQLite.
- Exportación.
- Logging y evidencias.
- Perfil configurable de selectores.

### Fase 2

- Ajuste fino contra el Banner real.
- Mapeo definitivo de campos visibles.
- Selectores más robustos por pantalla.
- Validación de estados `SIN_DOCENTE` y `NO_ENCONTRADO`.

### Fase 3

- Endurecimiento operativo.
- Métricas.
- Pruebas E2E con entorno de staging.
- Contenerización y despliegue.

### Fase 4

- Integración controlada con el sistema principal mediante adaptador o API interna.

## 7. Código y uso

### Variables de entorno

Completa `.env` tomando como base `.env.example`.

Variables más importantes:

- `DATABASE_URL="file:./banner-docente.db"`
- `BANNER_LOGIN_URL`
- `BANNER_SEARCH_URL`
- `BANNER_USERNAME`
- `BANNER_PASSWORD`
- `BANNER_PROFILE_PATH=./config/banner.profile.json`
- `BANNER_STORAGE_STATE_PATH=storage/auth/banner-storage-state.json`
- `BANNER_BROWSER_CHANNEL=msedge`
- `BANNER_LOOKUP_ENGINE=backend`
- `BANNER_BATCH_WORKERS=1`

### Instalación

```bash
npm install
npx prisma generate
npx prisma db push
```

Si prefieres `pnpm`, los scripts funcionan igual.

### Comandos

Autenticación manual visual con 2FA y guardado de sesión:

```bash
pnpm run auth
```

Buscar un NRC:

```bash
pnpm run lookup --nrc 12345 --period 202610
```

Forzar modo UI legado para comparaciones o fallback:

```bash
BANNER_LOOKUP_ENGINE=ui pnpm run lookup --nrc 12345 --period 202610
```

Procesar lote:

```bash
pnpm run batch --input ./nrcs.csv --period 202610 --query-name lote-febrero
```

Procesar lote con 3 workers experimentales:

```bash
pnpm run batch --input ./nrcs.csv --period 202610 --query-name lote-febrero --workers 3
```

Para operacion estable, usar `backend` con `1 worker`. `3 workers` queda como modo experimental mientras se endurece la restauracion concurrente de sesion.

Reanudar lote:

```bash
pnpm run batch --input ./nrcs.csv --query-id <QUERY_ID> --resume
```

Reintentar errores:

```bash
pnpm run retry-errors --query-id <QUERY_ID> --workers 3
```

Exportar:

```bash
pnpm run export --query-id <QUERY_ID> --format csv,json
```

### Hallazgos de red

En las trazas reales de Banner, los endpoints observados para este flujo fueron:

- `POST /BannerAdmin.ws/rest-services/message/`
- `GET /BannerAdmin.ws/rest-services/status`
- `GET /BannerAdmin.ws/views/net/hedtech/banner/student/schedule/umd/Ssasect/views/ViewMainWindow.html`

Conclusion:

- El unico endpoint util para datos y acciones es `rest-services/message/`.
- `status` solo sirve como verificacion del workspace.
- `ViewMainWindow.html` devuelve la vista, no el dato operativo del docente.
- No se encontro un endpoint mas directo para obtener el docente principal sin pasar por acciones Banner sobre `SSASECT` y `SIRASGN`.

### Estrategia recomendada para lotes grandes

La estrategia mas estable encontrada fue:

- una sola sesion autenticada
- un solo workspace `SSASECT`
- reusar el mismo task backend para todo el lote

Con esa ruta, la fase real de consulta quedo alrededor de `0.28s` por NRC una vez inicializada la sesion.

Estimacion operativa:

- `1900` NRC en una sola sesion continua: aproximadamente `9-10 minutos`

Esto es mejor que reiniciar navegador, reabrir workspaces o repartir la carga en varios workers que compitan por la misma sesion.

### Entrada

- `.csv` con columnas `nrc,period`
- `.txt` con una línea por NRC o `nrc,period`

### Salida

- Base local SQLite
- `storage/exports/*.csv`
- `storage/exports/*.json`
- `storage/evidence/**`
- `storage/logs/*.log`
- `storage/auth/banner-storage-state.json`

### Migración posterior a PostgreSQL

El modelo ya está desacoplado de SQLite. Para migrar:

1. Cambia `DATABASE_URL` a PostgreSQL.
2. Ejecuta `npm run prisma:generate:postgres`.
3. Ejecuta `npm run db:push:postgres` o tus migraciones sobre `prisma/schema.postgresql.prisma`.

### Ajuste real para Banner

Antes de usarlo con el Banner de la universidad, hay que revisar `config/banner.profile.json` y mapear:

- login
- frames
- ruta de navegación
- input de NRC
- resultados
- campos del docente

Ese archivo existe para evitar que la lógica de negocio dependa de selectores incrustados.

Actualmente el perfil base ya viene orientado al formulario `SSASECT` de UNIMINUTO, con:

- URL directa del formulario
- campo `Periodo` por `#inp:ssasectTermCode`
- campo `NRC` por `#inp:ssasectCrn`
- accion posterior `Instructores asignados`

Todavia falta afinar con HTML real:

- selectores del login
- contenedor exacto de resultados de instructores
- campo exacto de nombre/id del docente dentro de `SIRASGN`
