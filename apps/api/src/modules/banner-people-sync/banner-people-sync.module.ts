import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { MoodleAnalyticsModule } from '../moodle-analytics/moodle-analytics.module';
import { TeachersModule } from '../teachers/teachers.module';
import { BannerPeopleSyncController } from './banner-people-sync.controller';
import { BannerPeopleSyncService } from './banner-people-sync.service';

@Module({
  imports: [DatabaseModule, TeachersModule, MoodleAnalyticsModule],
  controllers: [BannerPeopleSyncController],
  providers: [BannerPeopleSyncService],
})
export class BannerPeopleSyncModule {}
