# Integracion Sidecar Moodle

## Resumen
Se integra un modulo sidecar Python que convive con el sistema Nest/Worker/Web sin reemplazarlo.

Capacidades:
- Clasificacion visual Moodle por NRC.
- Revalidacion selectiva de pendientes.
- Workers 1..8, resume/no-resume, headless/visible.
- Flujo GUI/CLI complementario.
- Backups de cursos `.mbz`.

## Configuracion central
- `storage/archive/system/moodle_sidecar.config.json`

## Ejecucion diaria (CLI)
- `python3 tools/moodle-sidecar/sidecar_runner.py classify`
- `python3 tools/moodle-sidecar/sidecar_runner.py revalidate --mode ambos`
- `python3 tools/moodle-sidecar/sidecar_runner.py backup`

## Modo solo integracion (sin revisar NRC otra vez)
Importa salidas historicas ya revisadas al modelo del sistema principal:
- `pnpm -C apps/api exec tsx scripts/moodle_url_resolver_adapter.ts "storage/inputs/classification_excels/LISTADO_NRC_REVISADOS_VISUALMENTE_TIPO_AULA_CON_TITULO.xlsx" --source=historico_visual`
- Agrega `--dry-run` si quieres validar metricas antes de escribir.

## Integracion con API (adapter)
- Script: `apps/api/scripts/moodle_url_resolver_adapter.ts`
- Modulo API: `/integrations/moodle-sidecar/*`

## Restricciones aplicadas
- No mezclar semestres por fallback.
- NRC canonico sin ceros a la izquierda.
- UNKNOWN no pisa plantilla valida existente.
