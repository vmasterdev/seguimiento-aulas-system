import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { z } from 'zod';
import { parseWithSchema } from '../common/zod.util';
import { MoodleUrlResolverAdapterService } from './moodle-url-resolver-adapter.service';

const ImportBodySchema = z.object({
  inputPath: z.string().trim().optional(),
  dryRun: z.coerce.boolean().optional().default(true),
  sourceLabel: z.string().trim().optional(),
});

@Controller('/integrations/moodle-sidecar')
export class MoodleUrlResolverAdapterController {
  constructor(
    @Inject(MoodleUrlResolverAdapterService)
    private readonly service: MoodleUrlResolverAdapterService,
  ) {}

  @Get('/config')
  getConfig() {
    return this.service.getConfig();
  }

  @Post('/import')
  async importContract(@Body() body: unknown) {
    const payload = parseWithSchema(ImportBodySchema, body, 'moodle-sidecar import body');
    return this.service.importFromContract(payload);
  }
}
