# Prompt para el otro proyecto (Codex)

Usa este prompt en el otro sistema para que se prepare como modulo integrable:

---

Necesito que organices este proyecto para integrarlo con `seguimiento-aulas-system`.

Objetivo:
- Crear un modulo/adaptador llamado `moodle_url_resolver_adapter`.
- Debe procesar NRC por periodo y devolver URL final de curso Moodle.

Reglas obligatorias:
- No rellenar NRC con ceros a la izquierda (usar `1121`, no `01121`).
- NRC canonico:
  - `prefijo = ultimos 2 digitos del periodCode`
  - `nrcCanonico = "<prefijo>-<nrcSinCerosIzquierda>"`
- No usar variantes de semestre contrario (sin fallback 10<->60 ni 15<->65).

Entradas minimas del adaptador:
- `periodCode`, `nrc`, `teacherId`, `programCode`, `subjectName`, `moment`.

Salida minima por NRC:
- `status` (`OK|NO_ENCONTRADO|SIN_MATRICULA|ERROR`)
- `moodleCourseUrl` (preferir `/course/view.php?id=...`)
- `moodleCourseId`
- `resolvedModality`
- `searchQuery`
- `errorDetail` (si aplica)

Comportamiento:
- Priorizar URL final `course/view.php?id=...`.
- Si no hay acceso o no existe, dejar URL de busqueda y estado claro.
- Permitir reproceso solo de pendientes.
- Registrar trazabilidad por NRC.

Entregables:
1. Estructura de carpetas limpia (src, adapters, contracts, tests, docs).
2. Contrato JSON del adaptador (`adapter-contract.json`).
3. Endpoint o comando CLI para ejecutar el resolver por lote.
4. Archivo de salida CSV/JSON listo para importar en `seguimiento-aulas-system`.
5. Documento corto de integracion con ejemplos.

---

Al finalizar, dame:
- Resumen de arquitectura del modulo.
- Comando exacto para ejecutarlo.
- Ejemplo real de salida de 5 NRC.

