import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { OutboxService } from './outbox.service';

@Controller('/outbox')
export class OutboxController {
  constructor(@Inject(OutboxService) private readonly outboxService: OutboxService) {}

  @Post('/generate')
  async generate(@Body() body: unknown) {
    return this.outboxService.generate(body);
  }

  @Post('/queue-cierre')
  async queueCierre(@Body() body: unknown) {
    return this.outboxService.queueCierre(body);
  }

  @Post('/export-eml')
  async export(@Body() body: unknown) {
    return this.outboxService.export(body);
  }

  @Post('/send')
  async send(@Body() body: unknown) {
    return this.outboxService.send(body);
  }

  @Post('/resend-updated')
  async resendUpdated(@Body() body: unknown) {
    return this.outboxService.resendUpdated(body);
  }

  @Post('/resend-by-course')
  async resendByCourse(@Body() body: unknown) {
    return this.outboxService.resendByCourse(body);
  }

  @Post('/preview-by-course')
  async previewByCourse(@Body() body: unknown) {
    return this.outboxService.previewByCourse(body);
  }

  @Post('/workshop-invitation/prepare')
  async prepareWorkshopInvitation(@Body() body: unknown) {
    return this.outboxService.prepareWorkshopInvitation(body);
  }

  @Get('/options')
  async options(@Query('yearPrefix') yearPrefix?: string) {
    return this.outboxService.options(yearPrefix);
  }

  @Get('/:id/preview')
  async preview(@Param('id') id: string) {
    return this.outboxService.preview(id);
  }

  @Get()
  async list(@Query('periodCode') periodCode?: string, @Query('status') status?: string) {
    return this.outboxService.list(periodCode, status);
  }

  @Get('/tracking')
  async tracking(
    @Query('periodCode') periodCode?: string,
    @Query('phase') phase?: 'ALISTAMIENTO' | 'EJECUCION',
    @Query('moment') moment?: 'MD1' | 'MD2' | '1' | 'INTER' | 'RM1' | 'RM2',
    @Query('audience') audience?: 'DOCENTE' | 'COORDINADOR' | 'GLOBAL',
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.outboxService.tracking({
      periodCode,
      phase,
      moment,
      audience,
      status,
      search,
      page,
      pageSize,
    });
  }
}
