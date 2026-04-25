import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ReviewController } from './review.controller';
import { DatabaseModule } from './database.module';
import { ImportModule } from './import/import.module';
import { QueueModule } from './queue/queue.module';
import { StatsModule } from './stats/stats.module';
import { CoursesModule } from './courses/courses.module';
import { SamplingModule } from './sampling/sampling.module';
import { EvaluationModule } from './evaluation/evaluation.module';
import { OutboxModule } from './outbox/outbox.module';
import { MoodleUrlResolverAdapterModule } from './moodle-url-resolver-adapter/moodle-url-resolver-adapter.module';
import { TeachersModule } from './teachers/teachers.module';
import { MoodleAnalyticsModule } from './moodle-analytics/moodle-analytics.module';
import { CoordinatorsModule } from './coordinators/coordinators.module';
import { BannerPeopleSyncModule } from './banner-people-sync/banner-people-sync.module';

@Module({
  imports: [
    DatabaseModule,
    ImportModule,
    QueueModule,
    StatsModule,
    CoursesModule,
    SamplingModule,
    EvaluationModule,
    OutboxModule,
    MoodleUrlResolverAdapterModule,
    TeachersModule,
    MoodleAnalyticsModule,
    CoordinatorsModule,
    BannerPeopleSyncModule,
  ],
  controllers: [HealthController, ReviewController],
})
export class AppModule {}
