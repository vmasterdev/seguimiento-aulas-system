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
- Estado Outbox:
  - DRAFT → EXPORTED → SENT_MANUAL (marcado por usuario)

## CC
- Coordinador: configurable por programa
- Academia: configurable (Enviar@Academia)
