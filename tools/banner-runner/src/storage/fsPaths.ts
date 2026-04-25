import { mkdirSync } from 'node:fs';

type StoragePathsOptions = {
  root?: string;
  evidenceDir?: string;
  exportsDir?: string;
  authDir?: string;
};

export async function ensureStoragePaths(opts: StoragePathsOptions): Promise<void> {
  const dirs = [
    opts.root,
    opts.evidenceDir,
    opts.exportsDir,
    opts.authDir,
  ].filter((d): d is string => Boolean(d));

  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}
