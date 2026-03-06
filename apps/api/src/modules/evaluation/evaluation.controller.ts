import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { EvaluationService } from './evaluation.service';

@Controller('/evaluation')
export class EvaluationController {
  constructor(@Inject(EvaluationService) private readonly evaluationService: EvaluationService) {}

  @Post('/score')
  async score(@Body() body: unknown) {
    return this.evaluationService.score(body);
  }

  @Post('/manual-override')
  async manualOverride(@Body() body: unknown) {
    return this.evaluationService.manualOverride(body);
  }

  @Post('/recalculate')
  async recalculate(@Body() body: unknown) {
    return this.evaluationService.recalculate(body);
  }

  @Post('/replicate-sampled')
  async replicateSampled(@Body() body: unknown) {
    return this.evaluationService.replicateSampled(body);
  }

  @Get('/nrc-trace')
  async nrcTrace(@Query() query: Record<string, unknown>) {
    return this.evaluationService.nrcTrace(query);
  }

  @Get()
  async list(@Query('periodCode') periodCode?: string, @Query('phase') phase?: string) {
    return this.evaluationService.list(periodCode, phase);
  }
}
