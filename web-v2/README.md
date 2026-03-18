# Ops Studio V2

Frontend principal de `seguimiento-aulas-system`.

## Objetivo

Unificar en una sola pantalla:

- estado general del sistema
- exploracion de cursos y trazabilidad operativa
- integracion Banner docente por NRC
- integracion Moodle sidecar
- centro de archivos y salidas operativas

Asumiendo `web-v2` como la unica interfaz web activa del sistema.

## Arranque

```bash
pnpm -C web-v2 dev
```

Produccion local:

```bash
pnpm -C web-v2 build
pnpm -C web-v2 start
```

Puerto por defecto: `3000`

Este es el frontend que arranca por defecto con `pnpm stack:up`.

## Variables utiles

Puedes crear `.env.local` en esta carpeta si quieres sobrescribir rutas o endpoint:

```bash
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:3001
INTERNAL_API_BASE_URL=http://127.0.0.1:3001
BANNER_PROJECT_ROOT=/mnt/c/Users/Duvan/Documents/banner buscador de docente en nrc
```

## Que integra

- API actual del sistema (`3001`)
- archivos de `storage/outputs/*`
- exportaciones y logs del proyecto Banner externo
- acciones web para:
  - cola Moodle
  - sidecar Moodle
  - lookup/lote/export/retry de Banner

## Nota

Si trabajas sobre `/mnt/c/...` desde WSL, el arranque de Node puede tardar mas por I/O del filesystem montado.
