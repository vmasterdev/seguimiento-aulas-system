# Plan de Retiro de `apps/web`

## Objetivo

Retirar `apps/web` y dejar `web-v2` como unico frontend operativo sin romper:

- RPACA
- revision/checklist
- automatizacion Banner
- automatizacion Moodle sidecar
- correos y reportes
- trazabilidad NRC

## Estado actual

- `web-v2` ya cubre los modulos principales del menu.
- `apps/web` sigue siendo tratado como frontend actual en scripts y documentacion.
- `scripts/dev-stack.sh` levanta `web` y `web_v2` al mismo tiempo.
- En `web-v2` aun hay deuda tecnica puntual que conviene cerrar antes del corte:
  - Banner duplicado en `app/lib/banner-runner.ts` y `app/_lib/banner-runner.ts`
  - validacion de build lenta/inconclusa sobre `/mnt/c`

## Criterio de salida antes del corte

Se puede apagar V1 cuando se cumplan estas condiciones:

1. `web-v2` pasa validacion funcional de:
   - `/rpaca`
   - `/review`
   - `/correos`
   - `/automatizacion-banner`
   - `/automatizacion-moodle`
   - `/nrc-globales`
   - `/nrc-trazabilidad`
2. `web-v2` queda con un solo runner de Banner.
3. `pnpm -C web-v2 build` queda estable en el entorno operativo objetivo.
4. El equipo opera una ventana corta solo con `web-v2` sin regresiones reportadas.

## Secuencia recomendada

### Fase 1. Congelar V1

- No agregar nuevas funciones en `apps/web`.
- Todo cambio funcional nuevo debe entrar en `web-v2`.
- Usar `apps/web` solo como referencia funcional mientras dure la comparacion.

### Fase 2. Unificar integraciones

- Dejar un unico runner de Banner en `web-v2`.
- Confirmar que `ops-studio` y el modulo Banner usen la misma ruta server y el mismo flujo.
- Cerrar los hallazgos de reportes y automatizacion antes del corte.

### Fase 3. Corte operativo

- Cambiar `scripts/dev-stack.sh` para levantar solo `web-v2`.
- Actualizar los `.cmd` de Windows para apuntar a `web-v2`.
- Actualizar `README.md` y `web-v2/README.md` para dejar a `web-v2` como frontend principal.
- Comunicar que la URL operativa unica pasa a ser `http://localhost:3010` o mover `web-v2` al puerto final definido.

### Fase 4. Retiro de codigo

- Sacar `apps/web` del workspace.
- Eliminar referencias residuales en scripts, docs y ayudas.
- Borrar `apps/web` solo despues del burn-in final.

## Recomendacion practica

No borrar `apps/web` en el mismo cambio donde `web-v2` pasa a produccion local. Primero haz el corte operativo y deja un burn-in corto. Luego eliminas V1 en un cambio aparte.
