import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { MoodleUrlResolverAdapterController } from './moodle-url-resolver-adapter.controller';
import { MoodleUrlResolverAdapterService } from './moodle-url-resolver-adapter.service';
import { MoodleSidecarRunnerController } from './moodle-sidecar-runner.controller';
import { MoodleSidecarRunnerService } from './moodle-sidecar-runner.service';
import { MoodleSidecarBatchService } from './moodle-sidecar-batch.service';

@Module({
  imports: [DatabaseModule],
  controllers: [MoodleUrlResolverAdapterController, MoodleSidecarRunnerController],
  providers: [MoodleUrlResolverAdapterService, MoodleSidecarRunnerService, MoodleSidecarBatchService],
  exports: [MoodleUrlResolverAdapterService, MoodleSidecarRunnerService, MoodleSidecarBatchService],
})
export class MoodleUrlResolverAdapterModule {}
