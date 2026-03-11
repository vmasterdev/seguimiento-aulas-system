import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../prisma.service';
import {
  AdapterRunOptions,
  loadSidecarConfig,
  resolveAdapterInputPath,
  resolveProjectRoot,
  runMoodleUrlResolverAdapter,
} from './adapter.logic';

@Injectable()
export class MoodleUrlResolverAdapterService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private resolveLatestAdapterInput(root: string): string | null {
    const validationDir = path.join(root, 'storage', 'outputs', 'validation');
    if (!fs.existsSync(validationDir)) return null;

    const entries = fs
      .readdirSync(validationDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(validationDir, entry.name))
      .filter((filePath) => /\.(csv|xlsx|xls|json)$/i.test(filePath))
      .filter((filePath) => {
        const base = path.basename(filePath).toLowerCase();
        if (base.includes('smoke')) return false;
        if (base === 'resultado_tipos_aula_desde_moodle.csv') return true;
        if (/^revalidacion_.*_revalidate_(sin_matricula|aulas_vacias|ambos)\.(csv|xlsx|xls|json)$/i.test(base)) {
          return true;
        }
        if (base.endsWith('_sin_matricula.csv') || base.endsWith('_sin_matricula.xlsx')) return false;
        if (base.endsWith('_aulas_vacias.csv') || base.endsWith('_aulas_vacias.xlsx')) return false;
        if (base === 'input_revalidate.csv' || base === 'nrcs_backup.csv') return false;
        return (
          base.startsWith('resultado_tipos_aula_desde_moodle') ||
          base.startsWith('revalidacion_')
        );
      })
      .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

    return entries[0] ?? null;
  }

  private resolveImportInputPath(root: string, options: AdapterRunOptions, config: ReturnType<typeof loadSidecarConfig>) {
    if (options.inputPath?.trim()) {
      return resolveAdapterInputPath(root, options.inputPath.trim());
    }

    const defaultInput = config.paths?.adapterDefaultInput
      ? resolveAdapterInputPath(root, config.paths.adapterDefaultInput)
      : path.join(root, 'storage', 'outputs', 'validation', 'RESULTADO_TIPOS_AULA_DESDE_MOODLE.csv');

    if (fs.existsSync(defaultInput)) {
      return defaultInput;
    }

    const latest = this.resolveLatestAdapterInput(root);
    if (latest) {
      return latest;
    }

    throw new BadRequestException(
      'No se encontro un archivo de resultado para importar. Ejecuta primero una clasificacion o revalidacion, o indica el archivo manualmente.',
    );
  }

  getConfig() {
    const root = resolveProjectRoot();
    const config = loadSidecarConfig(root);
    return {
      projectRoot: root,
      configPath: `${root}/storage/archive/system/moodle_sidecar.config.json`,
      config,
    };
  }

  async importFromContract(options: AdapterRunOptions) {
    const root = resolveProjectRoot();
    const config = loadSidecarConfig(root);
    const inputPath = this.resolveImportInputPath(root, options, config);

    return runMoodleUrlResolverAdapter(this.prisma as any, {
      ...options,
      inputPath,
      config,
    });
  }
}
