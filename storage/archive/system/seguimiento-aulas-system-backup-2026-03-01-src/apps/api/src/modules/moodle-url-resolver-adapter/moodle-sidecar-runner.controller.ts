import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../common/zod.util';
import { MoodleSidecarRunnerService } from './moodle-sidecar-runner.service';

const StartBodySchema = z.object({
  command: z.enum(['classify', 'revalidate', 'backup', 'gui']),
  inputDir: z.string().trim().optional(),
  output: z.string().trim().optional(),
  workers: z.coerce.number().int().min(1).max(8).optional(),
  browser: z.enum(['edge', 'chrome']).optional(),
  python: z.string().trim().optional(),
  headless: z.coerce.boolean().optional(),
  noResume: z.coerce.boolean().optional(),
  mode: z.enum(['sin_matricula', 'aulas_vacias', 'ambos']).optional(),
  nrcCsv: z.string().trim().optional(),
  loginWaitSeconds: z.coerce.number().int().min(30).max(3600).optional(),
  backupTimeout: z.coerce.number().int().min(30).max(3600).optional(),
  keepOpen: z.coerce.boolean().optional(),
});

@Controller('/integrations/moodle-sidecar/run')
export class MoodleSidecarRunnerController {
  constructor(
    @Inject(MoodleSidecarRunnerService)
    private readonly runnerService: MoodleSidecarRunnerService,
  ) {}

  @Get('/status')
  status() {
    return this.runnerService.getStatus();
  }

  @Post('/start')
  start(@Body() body: unknown) {
    const payload = parseWithSchema(StartBodySchema, body, 'moodle-sidecar run body');
    return this.runnerService.start(payload);
  }

  @Post('/cancel')
  cancel() {
    return this.runnerService.cancel();
  }
}
