# Salidas de correo (sin spam)

## Principio
- 1 correo por docente por **fase** (alistamiento/ejecución) y **momento**.
- Contenido:
  - NRC seleccionado por muestreo (marcado)
  - Puntaje (0..50), valoración (excelente/bueno/aceptable/insatisfactorio) a nivel total curso (0..100)
  - Observaciones (solo si faltan ítems; si 50/50, felicitación)
  - Lista de NRC del grupo (seleccionado + replicados) con estado "Muestreo"

## Implementación MVP
- Generar HTML (plantilla)
- Exportar archivo `.eml` para abrir en Outlook:
  - To, CC, Subject, HTML body embebido
- Envio SMTP controlado desde API:
  - `POST /outbox/send` con filtros por periodo/fase/momento/audiencia
  - `dryRun=true` para validar lote antes de enviar
  - `forceTo=<correo>` para pruebas controladas (ej. limitar 10 y enviar todo a un unico destinatario)
- Estado Outbox:
  - DRAFT → EXPORTED → SENT_MANUAL (marcado por usuario)
  - DRAFT/EXPORTED → SENT_AUTO (enviado por SMTP desde API)

## CC
- Coordinador: configurable por programa
- Academia: configurable (Enviar@Academia)
