# Organizacion de almacenamiento

## Objetivo
Centralizar archivos operativos fuera de la raiz del repo para facilitar mantenimiento y evitar mezclar codigo con insumos/salidas.

## Estructura

- `storage/inputs/rpaca_csv/`
  - CSV de programacion academica (RPACA002v1 por periodo/modalidad).
- `storage/inputs/reference_excels/`
  - Excel maestros de docentes/coordinadores.
- `storage/inputs/classification_excels/`
  - Excel de clasificacion visual de tipos de aula.
- `storage/outputs/validation/`
  - Reportes de validacion URL/NRC/docente.
- `storage/outputs/pending/`
  - Listas de NRC pendientes de URL final en Moodle.
- `storage/outputs/ok/`
  - Listas consolidadas de NRC OK con URL final.
- `storage/outputs/gaps/`
  - Faltantes funcionales (ej. tipo de aula sin clasificar).
- `storage/archive/system/`
  - Artefactos del sistema operativo o respaldos no funcionales.

## Regla de trabajo

- Nuevos insumos siempre a `storage/inputs/...`.
- Nuevas salidas siempre a `storage/outputs/...`.
- Evitar dejar archivos operativos en la raiz del repo.

## Nota

Si algun archivo de la raiz esta bloqueado por otro proceso (Windows/Excel), puede quedar copia temporal en raiz. La version organizada debe mantenerse en `storage/...`.

