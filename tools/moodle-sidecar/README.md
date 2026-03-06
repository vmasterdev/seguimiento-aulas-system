# Moodle Sidecar

Modulo sidecar para integracion con `seguimiento-aulas-system`.

## Comandos

Desde la raiz del proyecto:

- Clasificacion visual Moodle:
  - `python3 tools/moodle-sidecar/sidecar_runner.py classify`
- Revalidacion de pendientes:
  - `python3 tools/moodle-sidecar/sidecar_runner.py revalidate --mode ambos`
- Backups .mbz:
  - `python3 tools/moodle-sidecar/sidecar_runner.py backup`
- GUI (sin tocar la web principal):
  - `python3 tools/moodle-sidecar/sidecar_runner.py gui`

## Configuracion

Archivo central:
- `storage/archive/system/moodle_sidecar.config.json`

Reglas activas por defecto:
- NRC sin ceros a la izquierda.
- Sin fallback entre semestres.
- Modo estricto de modalidad.
- No sobrescribir tipo valido con UNKNOWN (aplicado en adapter API).
