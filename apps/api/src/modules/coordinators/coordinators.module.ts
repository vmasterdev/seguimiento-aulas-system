import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { CoordinatorsController } from './coordinators.controller';
import { CoordinatorsService } from './coordinators.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CoordinatorsController],
  providers: [CoordinatorsService],
})
export class CoordinatorsModule {}
