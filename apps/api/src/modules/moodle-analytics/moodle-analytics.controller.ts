import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { MoodleAnalyticsService } from './moodle-analytics.service';

@Controller('/integrations/moodle-analytics')
export class MoodleAnalyticsController {
  constructor(@Inject(MoodleAnalyticsService) private readonly analyticsService: MoodleAnalyticsService) {}

  @Post('/import/attendance')
  async importAttendance(@Body() body: unknown) {
    return this.analyticsService.importAttendance(body);
  }

  @Post('/import/activity')
  async importActivity(@Body() body: unknown) {
    return this.analyticsService.importActivity(body);
  }

  @Post('/import/participants')
  async importParticipants(@Body() body: unknown) {
    return this.analyticsService.importParticipants(body);
  }

  @Post('/import/banner-enrollment')
  async importBannerEnrollment(@Body() body: unknown) {
    return this.analyticsService.importBannerEnrollment(body);
  }

  @Get('/options')
  async options(@Query() query: Record<string, unknown>) {
    return this.analyticsService.options(query);
  }

  @Get('/overview')
  async overview(@Query() query: Record<string, unknown>) {
    return this.analyticsService.overview(query);
  }

  @Get('/attendance/date-report')
  async attendanceDateReport(@Query() query: Record<string, unknown>) {
    return this.analyticsService.attendanceDateReport(query);
  }

  @Get('/teacher-access-report')
  async teacherAccessReport(@Query() query: Record<string, unknown>) {
    return this.analyticsService.teacherAccessReport(query);
  }

  @Post('/apply-teacher-access')
  async applyTeacherAccess(@Body() body: unknown) {
    return this.analyticsService.applyTeacherAccessToChecklists(body as Record<string, unknown>);
  }
}
