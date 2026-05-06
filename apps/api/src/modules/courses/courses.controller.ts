import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CoursesService } from './courses.service';

@Controller('/courses')
export class CoursesController {
  constructor(@Inject(CoursesService) private readonly coursesService: CoursesService) {}

  @Get('/rpaca-report.csv')
  async rpacaReport(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const csv = await this.coursesService.rpacaReport(query);
    const period = typeof query.periodCode === 'string' && query.periodCode ? `_${query.periodCode}` : '';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="rpaca_report${period}.csv"`);
    res.send('﻿' + csv);
  }

  @Get('/missing-teacher/list')
  async missingTeacher(@Query() query: Record<string, unknown>) {
    return this.coursesService.missingTeacherList(query);
  }

  @Get('/banner-teachers/list')
  async bannerTeachersList(@Query() query: Record<string, unknown>) {
    return this.coursesService.bannerTeachersList(query);
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

  @Patch('/:id/moment')
  async updateMoment(@Param('id') id: string, @Body() body: unknown) {
    return this.coursesService.updateMoment(id, body);
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
