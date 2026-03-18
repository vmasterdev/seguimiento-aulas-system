# Criterios de aceptación (MVP)

## Ingesta
- Importar un CSV RPACA002v1 crea Courses con NRC normalizado.
- Enlaza Teacher por id_docente; si no existe, deja placeholder y marca "email_missing".

## Clasificación Moodle (worker)
- Encola N cursos y el worker actualiza MoodleCheck:
  - OK + detected_template
  - ERROR_REINTENTABLE con intentos
  - DESCARTADO_NO_EXISTE si no aparece el curso
- Guarda evidencia (screenshot + html) por curso.

## Muestreo
- Para un mismo docente con 5 NRC del mismo grupo, el sistema selecciona 1 y marca 4 replicados.
- La selección es estable si el seed no cambia.

## Evaluación
- Alistamiento:
  - CRIBA suma 50 si todos los ítems están en SI.
  - INNOVAME/D4 suma 50 con Plantilla+FP+FN+AA+ASIS.
- Ejecución:
  - Calcula 50 con todos los checks en SI y foros.
  - PP auto-pass: 50 sin checks.

## Outbox
- Genera 1 mensaje por docente por fase/momento (no por NRC).
- Exporta `.eml` válido.

## UI
- Dashboard lista:
  - Pendientes de clasificar
  - Errores reintentables
  - Reportes listos en outbox
