import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { SamplingService } from './sampling.service';

@Controller('/sampling')
export class SamplingController {
  constructor(@Inject(SamplingService) private readonly samplingService: SamplingService) {}

  @Post('/generate')
  async generate(@Body() body: unknown) {
    return this.samplingService.generate(body);
  }

  @Get()
  async list(@Query('periodCode') periodCode?: string) {
    return this.samplingService.list(periodCode);
  }

  @Get('/review-queue')
  async reviewQueue(
    @Query('periodCode') periodCode: string,
    @Query('phase') phase: 'ALISTAMIENTO' | 'EJECUCION' = 'ALISTAMIENTO',
    @Query('moment') moment?: string,
  ) {
    return this.samplingService.reviewQueue({ periodCode, phase, moment });
  }
}
