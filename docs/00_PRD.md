# PRD — Sistema de Seguimiento de Aulas Virtuales (UNIMINUTO)

## Objetivo
Reducir el tiempo y el riesgo operativo del seguimiento (alistamiento/ejecución) de ~1500 aulas virtuales,
automatizando:
1) Ingesta de datos (CSV RPACA002v1 + directorio docentes)
2) Clasificación del tipo de aula en Moodle **sin API** (UI automation)
3) Muestreo aleatorio por docente y replicación de resultados
4) Cálculo de puntajes y valoración
5) Generación de reportes y **un solo correo consolidado por fase/momento**

## Restricciones
- Sin permisos de API / sin intervención TI.
- La verificación en Moodle debe hacerse por interfaz (browser automation).
- Evitar "spam": no enviar 1 correo por NRC.
- Debe ser estable: cola, reintentos, trazabilidad, evidencia.

## Actores
- Operador Campus Digital (usuario principal)
- Coordinadores de programa (reciben consolidado)
- Directivas (reciben consolidado global)

## Entradas
- CSV RPACA002v1 por modalidad/periodo (ej. `202610 PREGRADO PRESENCIAL`, `202615 PREGRADO DISTANCIA`, etc.)
- Directorio docentes (fuente inicial: hoja "Profesores" del Excel legado) con:
  - id_docente, nombre, email institucional, centro/programa, sede, etc.
- (Opcional) Configuración de equivalencias de periodos → modalidad/tipo_curso (tabla configurable)

## Salidas
- Tabla operativa de seguimiento por NRC (tipo_aula, estado, evidencias)
- Reportes:
  - por Docente (consolidado por fase/momento, muestra seleccionada, observaciones)
  - por Coordinador/Programa
  - consolidado global por programa/modo/momento
- Bandeja de salida: correos HTML listos (o .eml) para envío controlado

## Flujo operativo (alto nivel)
1) Importar CSVs de programación académica
2) Enriquecer con directorio de docentes (correo, metadata)
3) Encolar NRCs para clasificación Moodle (tipo_aula + errores)
4) Aplicar muestreo: seleccionar 1 aula por grupo (Docente+Modalidad+Programa+Momento+TipoAula)
5) Registrar checklist de alistamiento/ejecución:
   - auto (cuando sea posible) + soporte a captura manual/semiautomática
6) Calcular puntajes y valoración
7) Generar reportes y correos consolidados
8) Auditoría: bitácora + evidencias (screenshots/HTML)

## Reglas de negocio (resumen)
- Tipos de aula: VACIO, CRIBA, INNOVAME, D4 (Distancia 4.0)
- Momentos: MD1 (8 semanas), MD2 (8 semanas), 1 (16 semanas). (Normalizar también INTER/RM1/RM2 si aparecen)
- Muestreo: 1 NRC por `Docente + Modalidad + Programa + Momento + TipoAula`
- PP (Pregrado Presencial, indicativos 10 y 60): ejecución **no aplica** y se marca como cumplida (50/50).
- Estados de clasificación Moodle:
  - OK
  - ERROR_REINTENTABLE (timeout, error temporal, sin acceso)
  - DESCARTADO_NO_EXISTE (aula no existe)
  - REVISAR_MANUAL (casos especiales)

## Métricas de éxito
- Reducir de ~1 semana (9h/día) a <= 1 día para clasificación + preparación de reportes
- <= 1% de cuelgues con pérdida de progreso (tolerancia 0; debe ser reanudable)
- 1 correo por docente por fase/momento (no por NRC)

## No objetivos (MVP)
- Integración por API con Moodle
- Envío SMTP institucional sin credenciales
