import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  loadSidecarConfig,
  resolveAdapterInputPath,
  resolveProjectRoot,
  runMoodleUrlResolverAdapter,
} from '../src/modules/moodle-url-resolver-adapter/adapter.logic';

function printHelp() {
  console.log(`moodle_url_resolver_adapter

Uso:
  pnpm -C apps/api exec tsx scripts/moodle_url_resolver_adapter.ts [inputPath] [--dry-run] [--source=etiqueta]

Opciones:
  inputPath          Ruta de entrada .csv | .json | .xlsx (opcional).
  --dry-run          No escribe en base de datos.
  --source=<texto>   Etiqueta para trazabilidad en notes.
  --help             Muestra esta ayuda.
`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    return { help: true, dryRun: false, sourceLabel: undefined as string | undefined, inputPath: undefined as string | undefined };
  }
  const dryRun = args.includes('--dry-run');
  const sourceArg = args.find((arg) => arg.startsWith('--source='));
  const sourceLabel = sourceArg ? sourceArg.split('=')[1] : undefined;
  const inputPath = args.find((arg) => !arg.startsWith('--'));
  return { help: false, dryRun, sourceLabel, inputPath };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const parsed = parseArgs(process.argv);
    if (parsed.help) {
      printHelp();
      return;
    }

    const root = resolveProjectRoot();
    const cfg = loadSidecarConfig(root);

    const defaultInput = cfg.paths?.adapterDefaultInput
      ? `${root}/${cfg.paths.adapterDefaultInput}`
      : `${root}/storage/outputs/validation/RESULTADO_TIPOS_AULA_DESDE_MOODLE.csv`;

    const inputPath = parsed.inputPath
      ? resolveAdapterInputPath(root, parsed.inputPath)
      : defaultInput;

    const result = await runMoodleUrlResolverAdapter(prisma as any, {
      inputPath,
      dryRun: parsed.dryRun,
      sourceLabel: parsed.sourceLabel,
      config: cfg,
    });

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
