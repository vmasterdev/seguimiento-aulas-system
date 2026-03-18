import { Controller, Get, Inject } from '@nestjs/common';
import { StatsService } from './stats.service';

@Controller('/stats')
export class StatsController {
  constructor(@Inject(StatsService) private readonly statsService: StatsService) {}

  @Get('/overview')
  async overview() {
    return this.statsService.overview();
  }
}
