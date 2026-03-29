import { BadRequestException, Body, Controller, Get, Inject, Post, Query, Res, StreamableFile } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { MomentSchema } from '@seguimiento/shared';
import { parseWithSchema } from '../common/zod.util';
import { MoodleSidecarRunnerService } from './moodle-sidecar-runner.service';
import { resolveProjectRoot } from './adapter.logic';
import type { Response } from 'express';

const StartBodySchema = z.object({
  command: z.enum(['classify', 'revalidate', 'backup', 'attendance', 'activity', 'participants', 'gui']),
  inputDir: z.string().trim().optional(),
  inputJson: z.string().trim().optional(),
  output: z.string().trim().optional(),
  outputDir: z.string().trim().optional(),
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
  nrcs: z.array(z.string().trim().min(1)).max(500).optional(),
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

const StartExtractionFromDatabaseSchema = DatabaseBatchSchema.extend({
  browser: z.enum(['edge', 'chrome']).optional(),
  python: z.string().trim().optional(),
  headless: z.coerce.boolean().optional(),
  loginWaitSeconds: z.coerce.number().int().min(30).max(3600).optional(),
  keepOpen: z.coerce.boolean().optional(),
  workers: z.coerce.number().int().min(1).max(8).optional(),
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

const ArtifactSummaryQuerySchema = z.object({
  outputPath: z.string().trim().optional(),
});

const DownloadQuerySchema = z.object({
  path: z.string().trim().min(1),
});

@Controller('/integrations/moodle-sidecar/run')
export class MoodleSidecarRunnerController {
  constructor(@Inject(MoodleSidecarRunnerService) private readonly runnerService: MoodleSidecarRunnerService) {}

  @Get('/status')
  status() {
    return this.runnerService.getStatus();
  }

  @Get('/batch/options')
  options() {
    return this.runnerService.getBatchOptions();
  }

  @Post('/batch/preview')
  preview(@Body() body: unknown) {
    const payload = parseWithSchema(DatabaseBatchSchema, body, 'moodle-sidecar batch preview body');
    return this.runnerService.previewBatch({
      ...payload,
      source: payload.source ?? 'PENDING',
    });
  }

  @Post('/revalidate/preview')
  previewRevalidate(@Body() body: unknown) {
    const payload = parseWithSchema(RevalidateDatabaseSchema, body, 'moodle-sidecar revalidate preview body');
    return this.runnerService.previewRevalidateBatch({
      ...payload,
      mode: payload.mode ?? 'ambos',
    });
  }

  @Post('/extract/preview')
  previewExtract(@Body() body: unknown) {
    const payload = parseWithSchema(DatabaseBatchSchema, body, 'moodle-sidecar extract preview body');
    return this.runnerService.previewExtractionBatch({
      ...payload,
      source: payload.source ?? 'ALL',
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

  @Post('/start-attendance-from-db')
  startAttendanceFromDb(@Body() body: unknown) {
    const payload = parseWithSchema(
      StartExtractionFromDatabaseSchema,
      body,
      'moodle-sidecar attendance from db body',
    );
    return this.runnerService.startAttendanceFromDatabase({
      ...payload,
      source: payload.source ?? 'ALL',
    });
  }

  @Post('/start-activity-from-db')
  startActivityFromDb(@Body() body: unknown) {
    const payload = parseWithSchema(
      StartExtractionFromDatabaseSchema,
      body,
      'moodle-sidecar activity from db body',
    );
    return this.runnerService.startActivityFromDatabase({
      ...payload,
      source: payload.source ?? 'ALL',
    });
  }

  @Post('/start-participants-from-db')
  startParticipantsFromDb(@Body() body: unknown) {
    const payload = parseWithSchema(
      StartExtractionFromDatabaseSchema,
      body,
      'moodle-sidecar participants from db body',
    );
    return this.runnerService.startParticipantsFromDatabase({
      ...payload,
      source: payload.source ?? 'ALL',
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

  @Get('/artifact-summary')
  artifactSummary(@Query() rawQuery: unknown) {
    const query = parseWithSchema(ArtifactSummaryQuerySchema, rawQuery, 'moodle-sidecar artifact summary query');
    const status = this.runnerService.getStatus();
    const outputPath = query.outputPath?.trim() || status.current?.outputPath || status.lastRun?.outputPath;
    return {
      outputPath: outputPath ?? null,
      summary: this.runnerService.getArtifactSummary(outputPath),
    };
  }

  @Get('/download')
  download(@Query() rawQuery: unknown, @Res({ passthrough: true }) response: Response) {
    const query = parseWithSchema(DownloadQuerySchema, rawQuery, 'moodle-sidecar download query');
    const root = resolveProjectRoot();
    const allowedRoot = path.resolve(root, 'storage', 'outputs', 'validation');
    const requested = path.isAbsolute(query.path) ? path.resolve(query.path) : path.resolve(root, query.path);

    if (requested !== allowedRoot && !requested.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new BadRequestException('La ruta solicitada no esta permitida.');
    }
    if (!fs.existsSync(requested) || !fs.statSync(requested).isFile()) {
      throw new BadRequestException('El archivo solicitado no existe o no es un archivo descargable.');
    }

    response.setHeader('Content-Disposition', `attachment; filename="${path.basename(requested)}"`);
    return new StreamableFile(fs.createReadStream(requested));
  }
}
