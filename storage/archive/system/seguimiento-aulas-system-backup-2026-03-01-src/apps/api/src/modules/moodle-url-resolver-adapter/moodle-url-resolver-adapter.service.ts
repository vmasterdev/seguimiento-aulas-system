import { Inject, Injectable } from '@nestjs/common';
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

    const defaultInput = config.paths?.adapterDefaultInput
      ? `${root}/${config.paths.adapterDefaultInput}`
      : `${root}/storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.csv`;

    const inputPath = options.inputPath?.trim()
      ? resolveAdapterInputPath(root, options.inputPath.trim())
      : defaultInput;

    return runMoodleUrlResolverAdapter(this.prisma as any, {
      ...options,
      inputPath,
      config,
    });
  }
}
