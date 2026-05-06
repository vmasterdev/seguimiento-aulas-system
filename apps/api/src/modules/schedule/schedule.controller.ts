import { Body, Controller, Delete, Get, Inject, Param, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ScheduleService } from './schedule.service';

@Controller()
export class ScheduleController {
  constructor(@Inject(ScheduleService) private readonly service: ScheduleService) {}

  // ── Schedule de NRC ──
  @Get('/schedule')
  async schedule(@Query() query: Record<string, unknown>) {
    return this.service.getSchedule(query);
  }

  // ── Standard classrooms (repositorio aulas) ──
  @Get('/standard-classrooms')
  async listClassrooms(@Query() query: Record<string, unknown>) {
    return this.service.listClassrooms(query);
  }

  @Post('/standard-classrooms')
  async upsertClassroom(@Body() body: unknown) {
    return this.service.upsertClassroom(body);
  }

  @Delete('/standard-classrooms/:id')
  async deleteClassroom(@Param('id') id: string) {
    return this.service.deleteClassroom(id);
  }

  // ── System settings (config recargo) ──
  @Get('/system-settings')
  async getSettings() {
    return this.service.getSettings();
  }

  @Put('/system-settings')
  async updateSettings(@Body() body: unknown) {
    return this.service.updateSettings(body);
  }

  // ── Recargo nocturno ──
  @Get('/recargo-nocturno')
  async recargoNocturno(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response) {
    const result = await this.service.computeRecargo(query);
    if ((query.format ?? '').toString().toLowerCase() === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="recargo-nocturno.csv"`);
      return result.csv;
    }
    return result.json;
  }

  // ── Metricas uso sedes/salones ──
  @Get('/metrics/usage')
  async metricsUsage(@Query() query: Record<string, unknown>) {
    return this.service.metricsUsage(query);
  }

  // ── Email docente con NRCs y aulas ──
  @Post('/teacher-schedule-email/preview')
  async previewEmail(@Body() body: unknown) {
    return this.service.previewTeacherEmail(body);
  }

  @Post('/teacher-schedule-email/send')
  async sendEmail(@Body() body: unknown) {
    return this.service.sendTeacherEmail(body);
  }
}
