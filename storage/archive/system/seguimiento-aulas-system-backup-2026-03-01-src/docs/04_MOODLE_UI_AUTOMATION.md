# Automatización UI Moodle (sin API)

## Objetivo
Dado un NRC, identificar:
- existe / no existe
- accesible / no accesible
- tipo de aula: VACIO / CRIBA / INNOVAME / D4

## Estrategia (robusta)
1) Login (sesión persistente)
2) Búsqueda NRC
   - Preferir búsqueda global o endpoint que devuelva resultados consistentes
3) Abrir curso
4) Extraer señales:
   - Conteo de recursos/actividades visibles
   - Textos de secciones (keywords)
   - Huellas del tema/plantilla (clases CSS o elementos únicos)
5) Clasificación:
   - VACIO: sin recursos y sin secciones típicas
   - CRIBA: presencia de conjunto de secciones/ítems (Bienvenida/Introducción/Objetivos/Temario/Calendario/etc)
   - INNOVAME: estructura mínima + AA + foros, sin paquete CRIBA
   - D4: similar a INNOVAME pero con huella estética (tema), si la huella existe
6) Evidencias:
   - screenshot
   - html snapshot
   - resumen de señales (json)

## Estados y reintentos
- TIMEOUT / navegación lenta: ERROR_REINTENTABLE, reintentar N veces
- SIN_ACCESO: ERROR_REINTENTABLE o REVISAR_MANUAL según patrón
- NO_EXISTE: DESCARTADO_NO_EXISTE

## Recomendación operativa
- Ejecutar workers con paralelismo moderado (3-6) para evitar bloqueos.
- Guardar storageState por entorno.
