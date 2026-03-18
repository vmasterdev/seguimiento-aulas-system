import { Body, Controller, Get, Inject, Param, Patch, Query } from '@nestjs/common';
import { CoursesService } from './courses.service';

@Controller('/courses')
export class CoursesController {
  constructor(@Inject(CoursesService) private readonly coursesService: CoursesService) {}

  @Get('/missing-teacher/list')
  async missingTeacher(@Query() query: Record<string, unknown>) {
    return this.coursesService.missingTeacherList(query);
  }

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.coursesService.list(query);
  }

  @Get('/:id')
  async byId(@Param('id') id: string) {
    return this.coursesService.byId(id);
  }

  @Patch('/:id/manual')
  async manualUpdate(@Param('id') id: string, @Body() body: unknown) {
    return this.coursesService.manualUpdate(id, body);
  }

  @Patch('/:id/teacher')
  async assignTeacher(@Param('id') id: string, @Body() body: unknown) {
    return this.coursesService.assignTeacher(id, body);
  }
}
