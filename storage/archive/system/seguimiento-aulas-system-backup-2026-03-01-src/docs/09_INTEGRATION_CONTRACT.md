# Contrato de integracion para otros sistemas

## Objetivo
Permitir que otro proyecto entregue un modulo compatible para conectarse a este sistema sin retrabajo.

## Contrato funcional minimo

El modulo externo debe poder entregar registros de curso con estos campos:

- `periodCode` (string, 6 digitos, ej. `202615`)
- `nrc` (string, sin ceros de relleno a la izquierda en la parte numerica)
- `teacherId` (string, ID o cedula normalizada)
- `teacherName` (string)
- `teacherEmail` (string opcional)
- `programCode` (string)
- `programName` (string)
- `subjectName` (string)
- `moment` (string: `MD1` | `MD2` | `1` | `INTER` opcional)
- `salon` (string opcional)
- `salon1` (string opcional)
- `templateDeclared` (string opcional: `VACIO` | `CRIBA` | `INNOVAME` | `D4`)

## Reglas obligatorias

- No usar NRC con cero inicial artificial:
  - Correcto: `1121`
  - Incorrecto: `01121`
- Para construir NRC canonico con prefijo:
  - `prefijo = periodCode[-2:]`
  - `nrcCanonico = "<prefijo>-<nrcNumericoSinCerosIzquierda>"`
- No usar variantes de semestre contrario (sin fallback 10<->60 ni 15<->65).

## Integracion por API (recomendada)

- Importar cursos:
  - `POST /import/csv` (o endpoint equivalente que tu modulo exponga)
- Encolar clasificacion Moodle:
  - `POST /queue/enqueue-classify`
- Reintentos:
  - `POST /queue/retry`
- Muestreo:
  - `POST /sampling/generate`
- Cola de revision:
  - `GET /sampling/review-queue`

## Contrato de URL Moodle final

Cuando el modulo externo resuelva URL final, debe guardar:

- `moodleCourseUrl`: `https://<campus>/course/view.php?id=<courseId>`
- `moodleCourseId`: `<courseId>`
- `resolvedModality`: `PRESENCIAL|DISTANCIA|POSGRADOS|MOOCS`

Si no hay acceso/curso:

- mantener URL de busqueda (`search.php`) como fallback
- registrar estado para reintento/manual (`REVISAR_MANUAL` o equivalente)

## Entrega esperada del modulo externo

- Un adaptador con entrada/salida estable (JSON/CSV).
- Logs de trazabilidad por NRC:
  - encontrado/no encontrado
  - sin matricula
  - url final resuelta
- Modo reproceso solo de pendientes.

