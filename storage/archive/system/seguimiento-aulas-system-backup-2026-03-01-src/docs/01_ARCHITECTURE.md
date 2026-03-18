# Arquitectura

## Componentes
1) **Web App** (Next.js):
   - Dashboard: estados, filtros, progreso por cola
   - Vistas: cursos, docentes, grupos de muestreo, reportes, outbox
   - Acciones: reintentar, descartar, marcar manual, exportar reportes

2) **API** (NestJS):
   - Ingesta CSV
   - Normalización (periodo→modalidad, momento, tipo_curso)
   - Motor de reglas (alistamiento/ejecución)
   - Muestreo aleatorio
   - Generación de HTML/.eml
   - Gestión de colas (BullMQ)

3) **Worker UI Automation** (Node + Playwright):
   - Consume cola `moodle.classify`
   - Abre Moodle, busca NRC, determina:
     - tipo_aula: VACIO/CRIBA/INNOVAME/D4
     - estado: OK/ERROR/DESCARTADO
   - Guarda evidencia: screenshot + html

4) **Infra**
   - Postgres (persistencia)
   - Redis (colas BullMQ)
   - Almacenamiento evidencias: filesystem (MVP), luego MinIO/S3

## Concurrencia y estabilidad
- N workers (configurable) con límite de paralelismo
- Reintentos con backoff, y "dead-letter" para revisión manual
- Todo es reanudable (idempotencia por jobKey = NRC+periodo)

## Seguridad operativa
- Credenciales Moodle en `.env` del worker
- Sesión persistida (storageState) para evitar login repetido
- Evidencias y logs trazables por NRC y ejecución

## Envío de correos (sin TI)
- MVP: generar HTML + `.eml` (RFC822) listo para abrir en Outlook y enviar manualmente
- Opción avanzada: automatización Outlook local (opcional; no habilitar por defecto)
