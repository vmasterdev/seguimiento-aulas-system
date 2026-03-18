import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { MoodleAnalyticsController } from './moodle-analytics.controller';
import { MoodleAnalyticsService } from './moodle-analytics.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MoodleAnalyticsController],
  providers: [MoodleAnalyticsService],
  exports: [MoodleAnalyticsService],
})
export class MoodleAnalyticsModule {}
