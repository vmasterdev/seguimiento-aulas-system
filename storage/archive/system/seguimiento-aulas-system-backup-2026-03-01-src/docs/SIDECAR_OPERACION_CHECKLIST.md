# Checklist Operativo Sidecar

1. Verificar config:
   - `storage/archive/system/moodle_sidecar.config.json`
2. Confirmar insumos:
   - `storage/inputs/rpaca_csv/*.csv`
   - `tools/moodle-sidecar/CURSOS DISTANCIA 4.0.xlsx`
3. Ejecutar clasificacion:
   - `python3 tools/moodle-sidecar/sidecar_runner.py classify`
4. Ejecutar adapter hacia DB:
   - `pnpm -C apps/api exec tsx scripts/moodle_url_resolver_adapter.ts`
5. Revalidar pendientes:
   - `python3 tools/moodle-sidecar/sidecar_runner.py revalidate --mode ambos`
6. Backups (si aplica):
   - `python3 tools/moodle-sidecar/sidecar_runner.py backup`
7. Verificar salidas:
   - `storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.xlsx`
   - `storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE_SIN_MATRICULA.xlsx`
   - `storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE_AULAS_VACIAS.xlsx`
