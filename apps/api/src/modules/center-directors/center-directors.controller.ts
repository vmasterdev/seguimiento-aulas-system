import { Body, Controller, Delete, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { CenterDirectorsService } from './center-directors.service';

@Controller('/center-directors')
export class CenterDirectorsController {
  constructor(@Inject(CenterDirectorsService) private readonly service: CenterDirectorsService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.service.list(query);
  }

  @Post()
  async upsert(@Body() body: unknown) {
    return this.service.upsertOne(body);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
