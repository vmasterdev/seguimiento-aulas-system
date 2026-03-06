import { BadRequestException, Body, Controller, Inject, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { AnyFilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ImportService } from './import.service';

@Controller('/import')
export class ImportController {
  constructor(@Inject(ImportService) private readonly importService: ImportService) {}

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
}
