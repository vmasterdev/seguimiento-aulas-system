import { Module } from '@nestjs/common';
import { SamplingController } from './sampling.controller';
import { SamplingService } from './sampling.service';

@Module({
  controllers: [SamplingController],
  providers: [SamplingService],
})
export class SamplingModule {}
