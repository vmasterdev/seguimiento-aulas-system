import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('/')
  root() {
    return { service: 'seguimiento-aulas-api', ok: true };
  }

  @Get('/health')
  health() {
    return { ok: true, ts: new Date().toISOString() };
  }
}
