import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { MomentSchema } from '@seguimiento/shared';
import { parseWithSchema } from '../common/zod.util';
import { MoodleSidecarRunnerService } from './moodle-sidecar-runner.service';
import { MoodleSidecarBatchService } from './moodle-sidecar-batch.service';

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
  preloginAllModalities: z.coerce.boolean().optional(),
  preloginModalities: z.array(z.string().trim().min(1)).max(8).optional(),
  modalidadesPermitidas: z.array(z.string().trim().min(1)).max(8).optional(),
});

const DatabaseBatchSchema = z.object({
  periodCodes: z.array(z.string().trim().min(3)).min(1).max(24),
  moments: z.array(MomentSchema).min(1).max(6).optional(),
  templates: z.array(z.string().trim().min(1)).max(20).optional(),
  source: z.enum(['PENDING', 'SAMPLING', 'ALL']).default('PENDING'),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

const StartFromDatabaseSchema = DatabaseBatchSchema.extend({
  workers: z.coerce.number().int().min(1).max(8).optional(),
  browser: z.enum(['edge', 'chrome']).optional(),
  python: z.string().trim().optional(),
  headless: z.coerce.boolean().optional(),
  noResume: z.coerce.boolean().optional(),
  output: z.string().trim().optional(),
  preloginAllModalities: z.coerce.boolean().optional(),
  preloginModalities: z.array(z.string().trim().min(1)).max(8).optional(),
  modalidadesPermitidas: z.array(z.string().trim().min(1)).max(8).optional(),
});

const StartBackupFromDatabaseSchema = DatabaseBatchSchema.extend({
  python: z.string().trim().optional(),
  loginWaitSeconds: z.coerce.number().int().min(30).max(3600).optional(),
  backupTimeout: z.coerce.number().int().min(30).max(3600).optional(),
  keepOpen: z.coerce.boolean().optional(),
});

const RevalidateDatabaseSchema = z.object({
  periodCodes: z.array(z.string().trim().min(3)).min(1).max(24),
  moments: z.array(MomentSchema).min(1).max(6).optional(),
  mode: z.enum(['sin_matricula', 'aulas_vacias', 'ambos']).default('ambos'),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
});

const StartRevalidateFromDatabaseSchema = RevalidateDatabaseSchema.extend({
  workers: z.coerce.number().int().min(1).max(8).optional(),
  browser: z.enum(['edge', 'chrome']).optional(),
  python: z.string().trim().optional(),
  headless: z.coerce.boolean().optional(),
  output: z.string().trim().optional(),
});

@Controller('/integrations/moodle-sidecar/run')
export class MoodleSidecarRunnerController {
  constructor(
    private readonly runnerService: MoodleSidecarRunnerService,
    private readonly batchService: MoodleSidecarBatchService,
  ) {}

  @Get('/status')
  status() {
    return this.runnerService.getStatus();
  }

  @Get('/batch/options')
  options() {
    return this.batchService.getOptions();
  }

  @Post('/batch/preview')
  preview(@Body() body: unknown) {
    const payload = parseWithSchema(DatabaseBatchSchema, body, 'moodle-sidecar batch preview body');
    return this.batchService.preview({
      ...payload,
      source: payload.source ?? 'PENDING',
    });
  }

  @Post('/revalidate/preview')
  previewRevalidate(@Body() body: unknown) {
    const payload = parseWithSchema(RevalidateDatabaseSchema, body, 'moodle-sidecar revalidate preview body');
    return this.batchService.previewRevalidate({
      ...payload,
      mode: payload.mode ?? 'ambos',
    });
  }

  @Post('/start')
  start(@Body() body: unknown) {
    const payload = parseWithSchema(StartBodySchema, body, 'moodle-sidecar run body');
    return this.runnerService.start(payload);
  }

  @Post('/start-from-db')
  startFromDb(@Body() body: unknown) {
    const payload = parseWithSchema(StartFromDatabaseSchema, body, 'moodle-sidecar run from db body');
    return this.runnerService.startFromDatabase({
      ...payload,
      source: payload.source ?? 'PENDING',
    });
  }

  @Post('/start-backup-from-db')
  startBackupFromDb(@Body() body: unknown) {
    const payload = parseWithSchema(StartBackupFromDatabaseSchema, body, 'moodle-sidecar backup from db body');
    return this.runnerService.startBackupFromDatabase({
      ...payload,
      source: payload.source ?? 'PENDING',
    });
  }

  @Post('/start-revalidate-from-db')
  startRevalidateFromDb(@Body() body: unknown) {
    const payload = parseWithSchema(
      StartRevalidateFromDatabaseSchema,
      body,
      'moodle-sidecar revalidate from db body',
    );
    return this.runnerService.startRevalidateFromDatabase({
      ...payload,
      mode: payload.mode ?? 'ambos',
    });
  }

  @Post('/cancel')
  cancel() {
    return this.runnerService.cancel();
  }
}
