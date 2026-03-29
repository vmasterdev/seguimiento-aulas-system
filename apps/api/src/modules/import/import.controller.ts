import { BadRequestException, Body, Controller, Inject, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportService } from './import.service';
import { MoodleAnalyticsService } from '../moodle-analytics/moodle-analytics.service';

@Controller('/import')
export class ImportController {
  constructor(
    @Inject(ImportService) private readonly importService: ImportService,
    @Inject(MoodleAnalyticsService) private readonly analyticsService: MoodleAnalyticsService,
  ) {}

  @Post('/csv')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: 15 * 1024 * 1024 },
    }),
  )
  async importCsv(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Debes adjuntar al menos un archivo CSV en multipart/form-data.');
    }

    const invalidFiles = files.filter((file) => !file.originalname.toLowerCase().endsWith('.csv'));
    if (invalidFiles.length) {
      throw new BadRequestException(
        `Todos los archivos RPACA deben ser .csv. Archivos invalidos: ${invalidFiles
          .map((file) => file.originalname)
          .join(', ')}`,
      );
    }

    return this.importService.importCsvFiles(files, body);
  }

  @Post('/teachers-xlsx')
  @UseInterceptors(
    AnyFilesInterceptor({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async importTeachersXlsx(
    @UploadedFiles() files: Express.Multer.File[],
    @Body() body: Record<string, unknown>,
  ) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Debes adjuntar un archivo Excel de docentes (.xlsx).');
    }

    const workbook =
      files.find((file) => file.originalname.toLowerCase().endsWith('.xlsx')) ?? files[0];

    return this.importService.importTeachersWorkbook(workbook, body);
  }

  @Post('/moodle-log-folder')
  async importMoodleLogFolder(@Body() body: unknown) {
    return this.importService.importMoodleLogsFromFolder(body);
  }

  @Post('/banner-dates-folder')
  async importBannerDatesFolder(@Body() body: unknown) {
    const result = await this.importService.importBannerDatesFromFolder(body);
    if (result.updated > 0) {
      // Recalcular ingresos para los periodos afectados
      for (const periodCode of result.periodCodes) {
        await this.analyticsService.applyTeacherAccessToChecklists({ periodCodes: periodCode });
      }
    }
    return result;
  }
}
