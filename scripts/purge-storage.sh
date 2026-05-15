#!/usr/bin/env bash
# Purga archivos de outputs procesados en storage/.
# Seguro: solo toca carpetas de batches/runs con timestamps, nunca inputs ni runtime.
# Uso: bash scripts/purge-storage.sh [--dry-run] [--days N]
#   --dry-run   Muestra qué se eliminaría sin borrar nada
#   --days N    Elimina directorios con más de N días (default: 30)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STORAGE="$ROOT_DIR/storage"

DRY_RUN=false
MAX_DAYS=30

for arg in "$@"; do
  case $arg in
    --dry-run) DRY_RUN=true ;;
    --days) shift; MAX_DAYS="$1" ;;
    --days=*) MAX_DAYS="${arg#*=}" ;;
  esac
done

echo "[purge-storage] Modo: $( [[ $DRY_RUN == true ]] && echo 'DRY RUN' || echo 'REAL' ) — eliminar dirs con más de $MAX_DAYS días"
echo ""

TOTAL_FREED=0
DELETED=0

purge_dir() {
  local target="$1"
  local label="$2"

  if [[ ! -d "$target" ]]; then
    return
  fi

  # Busca subdirectorios con nombre que empiece con fecha ISO (2026-*) o timestamp
  while IFS= read -r -d '' dir; do
    local age_days
    if command -v stat &>/dev/null; then
      local mtime
      mtime=$(stat -c %Y "$dir" 2>/dev/null || stat -f %m "$dir" 2>/dev/null || echo 0)
      local now
      now=$(date +%s)
      age_days=$(( (now - mtime) / 86400 ))
    else
      age_days=999
    fi

    if (( age_days >= MAX_DAYS )); then
      local size
      size=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "?")
      if [[ $DRY_RUN == true ]]; then
        echo "  [dry] borraría: $label/$(basename "$dir") ($size, ${age_days}d)"
      else
        echo "  [del] $label/$(basename "$dir") ($size, ${age_days}d)"
        rm -rf "$dir"
        DELETED=$((DELETED + 1))
      fi
    fi
  done < <(find "$target" -mindepth 1 -maxdepth 1 -type d -print0 2>/dev/null)
}

echo "=== sidecar-extract-batches ==="
purge_dir "$STORAGE/outputs/validation/sidecar-extract-batches" "sidecar-extract-batches"

echo "=== sidecar-batches ==="
purge_dir "$STORAGE/outputs/validation/sidecar-batches" "sidecar-batches"

echo "=== banner-batches ==="
purge_dir "$STORAGE/outputs/banner-batches" "banner-batches"

echo "=== banner-runs ==="
purge_dir "$STORAGE/outputs/banner-runs" "banner-runs"

echo "=== sidecar-runs ==="
purge_dir "$STORAGE/outputs/validation/sidecar-runs" "sidecar-runs"

echo ""
echo "=== archive/imports/rpaca (JSON > $MAX_DAYS días) ==="
if [[ -d "$STORAGE/archive/imports/rpaca" ]]; then
  while IFS= read -r -d '' file; do
    local_age=999
    if command -v stat &>/dev/null; then
      mtime=$(stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo 0)
      now=$(date +%s)
      local_age=$(( (now - mtime) / 86400 ))
    fi
    if (( local_age >= MAX_DAYS )); then
      size=$(du -sh "$file" 2>/dev/null | cut -f1 || echo "?")
      if [[ $DRY_RUN == true ]]; then
        echo "  [dry] borraría: rpaca/$(basename "$file") ($size, ${local_age}d)"
      else
        echo "  [del] rpaca/$(basename "$file") ($size, ${local_age}d)"
        rm -f "$file"
        DELETED=$((DELETED + 1))
      fi
    fi
  done < <(find "$STORAGE/archive/imports/rpaca" -maxdepth 1 -name "*.json" -print0 2>/dev/null)
fi

echo ""
if [[ $DRY_RUN == true ]]; then
  echo "[purge-storage] Dry run completo. Ejecuta sin --dry-run para borrar."
else
  echo "[purge-storage] Listo. $DELETED elementos eliminados."
fi
