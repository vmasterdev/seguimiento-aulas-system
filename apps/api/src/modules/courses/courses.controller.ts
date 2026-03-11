import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { CoursesService } from './courses.service';

@Controller('/courses')
export class CoursesController {
  constructor(@Inject(CoursesService) private readonly coursesService: CoursesService) {}

  @Get('/missing-teacher/list')
  async missingTeacher(@Query() query: Record<string, unknown>) {
    return this.coursesService.missingTeacherList(query);
  }

  @Get('/moodle-followup/list')
  async moodleFollowup(@Query() query: Record<string, unknown>) {
    return this.coursesService.moodleFollowupList(query);
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

  @Post('/:id/deactivate')
  async deactivate(@Param('id') id: string, @Body() body: unknown) {
    return this.coursesService.deactivate(id, body);
  }

  @Post('/deactivate-batch')
  async deactivateBatch(@Body() body: unknown) {
    return this.coursesService.deactivateBatch(body);
  }

  @Post('/:id/checklist-temporal')
  async setChecklistTemporal(@Param('id') id: string, @Body() body: unknown) {
    return this.coursesService.setChecklistTemporal(id, body);
  }
}
