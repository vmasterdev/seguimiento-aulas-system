# Rollback Sidecar

Si se requiere revertir la integracion sidecar sin afectar el sistema principal:

1. Quitar modulo API:
   - remover `MoodleUrlResolverAdapterModule` de `apps/api/src/modules/app.module.ts`
   - eliminar carpeta `apps/api/src/modules/moodle-url-resolver-adapter`
   - eliminar script `apps/api/scripts/moodle_url_resolver_adapter.ts`

2. Quitar comandos package:
   - eliminar scripts `sidecar:*` en `package.json`
   - eliminar scripts `sidecar:adapter*` en `apps/api/package.json`

3. Quitar sidecar operativo:
   - eliminar `tools/moodle-sidecar`
   - conservar (no borrar) datos existentes en `storage/outputs/*`

4. Quitar docs de integracion:
   - `docs/SIDECAR_*`

5. Reiniciar servicios:
   - `pnpm dev`

Nota:
- El rollback no altera tablas ni datos persistidos de cursos ya importados.
