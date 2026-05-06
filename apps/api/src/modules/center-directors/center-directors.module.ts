import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database.module';
import { CenterDirectorsController } from './center-directors.controller';
import { CenterDirectorsService } from './center-directors.service';

@Module({
  imports: [DatabaseModule],
  controllers: [CenterDirectorsController],
  providers: [CenterDirectorsService],
})
export class CenterDirectorsModule {}
