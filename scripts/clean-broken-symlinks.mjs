#!/usr/bin/env node
/**
 * Borra symlinks `.ignored_*` huérfanos que pnpm deja al reemplazar versiones
 * de paquetes. En Windows son ReparsePoint rotos: `scandir` falla con EACCES y
 * rompe `next build` ("glob error" / "Unable to snapshot resolve dependencies").
 *
 * Corre en `postinstall` para que el problema no reaparezca tras cada install.
 * En Linux/Mac normalmente no hay nada que limpiar — el recorrido es barato.
 */
import { readdir, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
// No recorremos dentro de estos: ni aportan symlinks .ignored_* ni vale la pena.
const SKIP_DIRS = new Set(['.git', '.next', '.turbo', 'dist', 'build', 'storage']);

let removed = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // dir ilegible (ej. otro symlink roto) — ignorar
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.name.startsWith('.ignored')) {
      try {
        await rm(full, { recursive: true, force: true });
        removed++;
      } catch {
        // ignorar — si no se puede borrar, no es peor que antes
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    // No seguir symlinks de directorio: pnpm los usa por todo node_modules y
    // recorrerlos dispara el mismo EACCES que intentamos evitar.
    try {
      const st = await lstat(full);
      if (st.isSymbolicLink()) continue;
    } catch {
      continue;
    }
    await walk(full);
  }
}

await walk(ROOT);
if (removed > 0) {
  console.log(`[clean:symlinks] ${removed} symlink(s) .ignored_* huérfano(s) eliminado(s).`);
}
