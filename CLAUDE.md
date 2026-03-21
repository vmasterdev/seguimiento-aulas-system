# Claude Code Handoff

## Contexto rapido

Monorepo operativo para seguimiento de aulas Moodle sin API institucional.

- `apps/api`: NestJS + Prisma + BullMQ.
- `apps/worker`: worker Playwright para automatizaciones Moodle.
- `web-v2`: frontend principal y consola operativa.
- `packages/shared`: reglas y esquemas compartidos.
- `tools/moodle-sidecar`: automatizacion Python sidecar para Moodle.

`web-v2` es la interfaz principal. Cuando haya que agregar funcionalidad nueva de UI, debe entrar ahi.

## Arranque local

Infra:

```bash
docker compose -f infra/docker-compose.yml up -d
```

Stack completo:

```bash
pnpm stack:up
pnpm stack:status
pnpm stack:down
```

Builds de verificacion:

```bash
pnpm -C apps/api build
pnpm -C apps/worker build
pnpm -C web-v2 build
```

## Variables y rutas importantes

- `apps/api/.env.example`
- `apps/worker/.env.example`
- `web-v2/.env.example`
- Estado del stack: `storage/runtime/dev-stack/stack.env`
- Config del runner Banner: `storage/runtime/banner/runner-config.json`

Variables utiles:

- `BANNER_PROJECT_ROOT`: ruta al proyecto externo de Banner.
- `API_LINUX_RUN_DIR`: shadow Linux del API usado por `scripts/dev-stack.sh` cuando el repo corre desde `/mnt/c/...`.
- `NEXT_PUBLIC_API_BASE_URL` / `INTERNAL_API_BASE_URL`: endpoint backend para `web-v2`.
- `MOODLE_AUDITOR_TEMPLATE_PATH`: ruta a `FORMATO CREACION DE USUARIOS OFICIAL.xlsx`.

## Integraciones externas

### Banner

La UI y el backend asumen un proyecto externo de Banner con CLI propio. La ruta efectiva se resuelve en este orden:

1. `storage/runtime/banner/runner-config.json`
2. `BANNER_PROJECT_ROOT`
3. carpetas hermanas comunes del repo
4. rutas conocidas en `$HOME`

Archivos clave:

- `web-v2/app/_lib/banner-runner.ts`
- `apps/api/src/modules/banner-people-sync/banner-people-sync.service.ts`

### Moodle Sidecar

La operacion sidecar vive principalmente en:

- `tools/moodle-sidecar`
- `apps/api/src/modules/moodle-url-resolver-adapter`
- `web-v2/app/_features/sidecar`
- `web-v2/app/_features/moodle-analytics`

## Archivos de alto impacto

- `scripts/dev-stack.sh`: arranque local, tmux, puertos, shadow API.
- `web-v2/app/lib/ops-data.ts`: agregado principal de datos de la consola.
- `web-v2/app/ops-studio.tsx`: shell principal.
- `apps/api/prisma/schema.prisma`: modelo de datos.
- `README.md`: operacion general.

## Convenciones practicas

- No revertir artefactos de `storage/` sin revisar si son salida operativa del usuario.
- Preferir cambios en `web-v2`; no reintroducir `apps/web`.
- Si tocas Banner o sidecar, validar al menos build de `web-v2` y `apps/api`.
- Si una ruta absoluta del entorno deja de existir, prioriza moverla a config o `.env`, no dejarla hardcodeada.

## Estado validado en este handoff

Se verifico build exitoso de:

- `pnpm -C apps/api build`
- `pnpm -C apps/worker build`
- `pnpm -C web-v2 build`
