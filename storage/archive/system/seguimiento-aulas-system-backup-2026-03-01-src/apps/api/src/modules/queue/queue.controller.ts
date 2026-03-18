import { Body, Controller, Get, Inject, Post } from '@nestjs/common';
import { QueueEnqueueSchema } from '@seguimiento/shared';
import { parseWithSchema } from '../common/zod.util';
import { QueueService } from './queue.service';

@Controller('/queue')
export class QueueController {
  constructor(@Inject(QueueService) private readonly queueService: QueueService) {}

  @Post('/enqueue-classify')
  async enqueue(@Body() body: unknown) {
    const payload = parseWithSchema(QueueEnqueueSchema, body, 'enqueue request');
    return this.queueService.enqueueClassify(payload);
  }

  @Post('/retry')
  async retry(@Body() body: unknown) {
    const payload = parseWithSchema(QueueEnqueueSchema, body, 'retry request');
    return this.queueService.retryErrors(payload);
  }

  @Get('/stats')
  async stats() {
    return this.queueService.queueStats();
  }
}
