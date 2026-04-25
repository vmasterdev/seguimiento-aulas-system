import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { BannerPeopleSyncService } from './banner-people-sync.service';
import { MoodleAnalyticsService } from '../moodle-analytics/moodle-analytics.service';

@Controller('/integrations/banner-people')
export class BannerPeopleSyncController {
  constructor(
    @Inject(BannerPeopleSyncService) private readonly bannerPeopleSyncService: BannerPeopleSyncService,
    @Inject(MoodleAnalyticsService) private readonly moodleAnalyticsService: MoodleAnalyticsService,
  ) {}

  @Post('/spaiden-sync')
  async sync(@Body() body: unknown) {
    return this.bannerPeopleSyncService.sync(body);
  }

  @Post('/roster-sync')
  async rosterSync(@Body() body: unknown) {
    const rosterResult = await this.bannerPeopleSyncService.rosterSync(body);
    const importResult = await this.moodleAnalyticsService.importBannerEnrollment({
      inputPath: rosterResult.rosterCsvPath,
    });
    const stats = await this.bannerPeopleSyncService.uniqueStudentCount(rosterResult.periodCode);
    return {
      ok: true,
      roster: rosterResult,
      import: importResult,
      uniqueStudents: stats.uniqueStudents,
      totalRows: stats.totalRows,
    };
  }

  @Get('/unique-students')
  async uniqueStudents(@Query('periodCode') periodCode: string) {
    if (!periodCode?.trim()) {
      return { error: 'Se requiere periodCode' };
    }
    return this.bannerPeopleSyncService.uniqueStudentCount(periodCode.trim());
  }
}
