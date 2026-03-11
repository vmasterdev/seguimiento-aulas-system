# Refactor y Limpieza

## Estado actual

En marzo de 2026 se hizo una limpieza estructural del sistema enfocada en reducir duplicacion, mover archivos a dominios mas claros y retirar artefactos que ya no aportaban al runtime.

## Cambios aplicados

### 1. `apps/web` reorganizado por dominio

Antes la carpeta `apps/web/app` estaba practicamente plana. Ahora la estructura util queda asi:

```text
apps/web/app
├── _components
│   ├── main-menu.tsx
│   └── page-shell.tsx
├── _features
│   ├── correos
│   ├── docentes
│   ├── nrc
│   ├── review
│   ├── rpaca
│   └── sidecar
├── _lib
│   ├── api.ts
│   └── http.ts
├── correos/page.tsx
├── docentes/page.tsx
├── nrc-globales/page.tsx
├── nrc-trazabilidad/page.tsx
├── review/page.tsx
├── rpaca/page.tsx
└── page.tsx
```

Objetivo:
- separar componentes compartidos, features y utilidades;
- evitar paneles gigantes en la raiz del `app`;
- facilitar mantenimiento por modulo funcional.

### 2. `shared` limpio de duplicados JS

Se eliminaron archivos `.js` en `packages/shared/src` que duplicaban la fuente TypeScript:

- `index.js`
- `normalizers.js`
- `rules.js`
- `schemas.js`

El paquete ya compila desde TS y publica en `dist`, por lo que esos archivos fuente en JS solo agregaban ruido y riesgo de divergencia.

### 3. `outbox` con modulos internos separados

Se empezo a desmontar el monolito de `apps/api/src/modules/outbox/outbox.service.ts` extrayendo piezas puras a archivos dedicados:

- `outbox.constants.ts`
- `outbox.types.ts`
- `outbox.schemas.ts`
- `outbox.utils.ts`

Esto ya saco del servicio:
- constantes de momentos y URLs;
- tipos de payload y filas agregadas;
- schemas de reenvio y preview;
- helpers de normalizacion, parsing, sanitizacion y formateo.

### 4. Helper HTTP comun en frontend

Se unifico la logica repetida de `fetch` en:

- `apps/web/app/_lib/http.ts`

Con eso los paneles dejaron de repetir el mismo bloque de manejo de errores y `cache: 'no-store'`.

### 5. Archivos temporales retirados

Se eliminaron:

- `apps/api/tmp-test.ts`
- `apps/api/tmp-test-nest.ts`

## Elementos que se conservaron a proposito

### `web-v2`

No se elimino porque sigue siendo una version activa del producto.

### `ejemplo_reportes`

Se conserva solo como referencia historica de estilos y ejemplos visuales. El runtime del `outbox` ya no depende de esa carpeta.

## Validaciones hechas

Se validaron estos comandos despues de la limpieza:

```bash
pnpm -C packages/shared build
pnpm -C apps/web exec tsc --noEmit
pnpm -C apps/api exec tsc -p tsconfig.json --noEmit --pretty false
```

## Backlog recomendado

Estos son los siguientes cambios de mayor impacto que aun valen la pena:

1. Separar `outbox.service.ts` por responsabilidad:
   - render HTML;
   - generacion de mensajes;
   - envio/deduplicacion;
   - preview/regeneracion.

2. Seguir partiendo `outbox.service.ts`:
   - separar generacion;
   - envio/deduplicacion;
   - preview/regeneracion.

3. Agregar pruebas de regresion minima:
   - generar preview docente;
   - generar preview coordinador;
   - generar preview global;
   - validar deduplicacion y regeneracion.

4. Revisar almacenamiento operativo:
   - respaldos;
   - archivos de salida grandes;
   - snapshots de ejecucion sidecar.

## Criterio de limpieza futura

No borrar archivos o carpetas solo por verse antiguos. Primero validar una de estas condiciones:

- no hay imports activos;
- no hay referencias en README o docs operativas;
- no los consume el runtime ni los scripts;
- existe un reemplazo unico ya probado.
