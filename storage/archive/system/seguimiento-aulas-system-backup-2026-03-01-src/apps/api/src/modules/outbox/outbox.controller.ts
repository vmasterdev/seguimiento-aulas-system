import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Controller('/outbox')
export class OutboxController {
  constructor(@Inject(OutboxService) private readonly outboxService: OutboxService) {}

  @Post('/generate')
  async generate(@Body() body: unknown) {
    return this.outboxService.generate(body);
  }

  @Post('/export-eml')
  async export(@Body() body: unknown) {
    return this.outboxService.export(body);
  }

  @Get()
  async list(@Query('periodCode') periodCode?: string, @Query('status') status?: string) {
    return this.outboxService.list(periodCode, status);
  }
}
