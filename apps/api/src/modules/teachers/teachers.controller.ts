import { BadRequestException, Body, Controller, Get, Inject, Post, Query, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { TeachersService } from './teachers.service';

@Controller('/teachers')
export class TeachersController {
  constructor(@Inject(TeachersService) private readonly teachersService: TeachersService) {}

  @Get()
  async list(@Query() query: Record<string, unknown>) {
    return this.teachersService.list(query);
  }

  @Post()
  async upsert(@Body() body: unknown) {
    return this.teachersService.upsertOne(body);
  }

  @Post('/consolidate-banner-ids')
  async consolidateBannerIds() {
    return this.teachersService.consolidateBannerIdsFromResolvedCourses();
  }

  @Post('/import-csv')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importCsv(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Debes adjuntar al menos un CSV de docentes.');
    }
    return this.teachersService.importCsv(files, body);
  }
}
