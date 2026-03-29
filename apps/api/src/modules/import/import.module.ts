import { Module } from '@nestjs/common';
import { ImportController } from './import.controller';
import { ImportService } from './import.service';
import { MoodleAnalyticsModule } from '../moodle-analytics/moodle-analytics.module';

@Module({
  imports: [MoodleAnalyticsModule],
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}
