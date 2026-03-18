# Contrato `moodle_url_resolver_adapter`

## Formato CSV / JSON / XLSX soportado
Campos soportados por fila:
- `NRC`
- `PERIODOS` (o `PERIODO`)
- `TIPO_AULA`
- `ESTADO`
- `COURSE_ID`
- `MODALIDAD_DONDE_SE_ENCONTRO` (o `MODALIDAD`)
- `URL_FINAL` (opcional)
- `ERROR` (opcional)

## Reglas de normalizacion
- NRC canonico por periodo: `PP-NNNN...` usando prefijo del periodo (sin fallback entre semestres).
- NRC sin ceros a la izquierda.
- `TIPO_AULA` se mapea a: `VACIO`, `CRIBA`, `INNOVAME`, `D4`, `UNKNOWN`.
- `UNKNOWN` no reemplaza una plantilla valida ya guardada.

## Mapping de estados
- `OK` -> `OK`
- `SIN_MATRICULA` -> `REVISAR_MANUAL` + `SIN_ACCESO`
- `NO_ENCONTRADO_MODALIDAD_OBJETIVO` -> `DESCARTADO_NO_EXISTE` + `NO_EXISTE`
- `ERROR_*` -> `ERROR_REINTENTABLE`

## Templates de referencia
- `storage/archive/system/contracts/moodle_url_resolver_adapter.contract.csv`
- `storage/archive/system/contracts/moodle_url_resolver_adapter.contract.json`

## Uso de integracion sin reprocesar Moodle
Para importar resultados historicos ya revisados (sin lanzar workers visuales), usa:
- `pnpm -C apps/api exec tsx scripts/moodle_url_resolver_adapter.ts "storage/inputs/classification_excels/LISTADO_NRC_REVISADOS_VISUALMENTE_TIPO_AULA_CON_TITULO.xlsx" --source=historico_visual`
