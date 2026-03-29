import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { CoordinatorsService } from './coordinators.service';

@Controller('/coordinators')
export class CoordinatorsController {
  constructor(@Inject(CoordinatorsService) private readonly coordinatorsService: CoordinatorsService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.coordinatorsService.list(query);
  }

  @Post()
  async upsert(@Body() body: unknown) {
    return this.coordinatorsService.upsertOne(body);
  }
}
