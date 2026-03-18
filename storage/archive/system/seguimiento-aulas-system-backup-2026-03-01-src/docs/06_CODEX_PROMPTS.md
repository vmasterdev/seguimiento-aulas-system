# Prompts para Codex (ejecución por etapas)

> Objetivo: que Codex implemente el sistema completo con estabilidad y buen rendimiento.
> Stack: Node/TS monorepo (pnpm + turborepo), NestJS + Prisma (API), Next.js (Web), Playwright + BullMQ (Worker).
> DB: Postgres. Cola: Redis.

## Etapa 0 — Preparación
Prompt a Codex:
- "Lee todo `/docs/*.md` y crea un plan de implementación por milestones (MVP→v1)."
- "No cambies el stack. Mantén tipado estricto. Usa zod para validación."

## Etapa 1 — Base monorepo y configuración
Prompt:
- "Inicializa monorepo pnpm + turborepo con apps/api, apps/web, apps/worker, packages/shared."
- "Incluye docker-compose (Postgres + Redis)."
- "Configura lint/format (eslint, prettier) y scripts root: dev/build/test."

## Etapa 2 — Modelo de datos + Prisma
Prompt:
- "Implementa Prisma schema según docs/02_DATA_MODEL.md."
- "Agrega migraciones y seed básico (Period ejemplares)."
- "Crea repositorios/servicios en API para CRUD mínimo: Period, Teacher, Course."

## Etapa 3 — Ingesta CSV RPACA002v1
Prompt:
- "Implementa endpoint /import/csv para cargar uno o varios archivos RPACA002v1."
- "Normaliza period_code, moment, NRC (prefijo 65-), y enlaza con Teacher (por id_docente)."
- "Guarda raw_json."

## Etapa 4 — Cola BullMQ y Worker Playwright (clasificación Moodle)
Prompt:
- "Crea cola moodle.classify en Redis."
- "API endpoint para encolar cursos pendientes."
- "Worker: consume jobs, login moodle con storageState, busca NRC y clasifica."
- "Guarda MoodleCheck + evidencias (screenshot/html)."
- "Implementa reintentos y dead-letter."

## Etapa 5 — Muestreo aleatorio
Prompt:
- "Implementa SampleGroup: agrupar por teacher+modality+program+moment+template."
- "Selecciona 1 curso por grupo con seed guardada."
- "Marca replicados."

## Etapa 6 — Motor de reglas (rubricas)
Prompt:
- "Implementa cálculo Alistamiento/Ejecución según docs/03_RUBRICS.md."
- "Implementa regla PP: ejecución auto-pass 50."
- "Exponer endpoint para recalcular y guardar Evaluation."

## Etapa 7 — Reportes y Outbox
Prompt:
- "Genera reportes por docente por fase/momento."
- "Genera HTML profesional y exporta .eml."
- "Implementa OutboxMessage con estados."

## Etapa 8 — Web dashboard
Prompt:
- "Dashboard con tablas filtrables: Cursos, MoodleChecks, SampleGroups, Evaluations, Outbox."
- "Acciones: Reintentar, Descarta, Reprocesar, Exportar correo."

## Etapa 9 — Calidad
Prompt:
- "Pruebas unitarias para rubricas, muestreo, normalización."
- "Pruebas e2e básicas API."
- "Logging y manejo de errores consistente."

## Criterios de aceptación
Ver `docs/07_ACCEPTANCE_TESTS.md`.
