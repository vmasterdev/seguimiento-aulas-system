import { Body, Controller, Inject, Post } from '@nestjs/common';
import { BannerPeopleSyncService } from './banner-people-sync.service';

@Controller('/integrations/banner-people')
export class BannerPeopleSyncController {
  constructor(@Inject(BannerPeopleSyncService) private readonly bannerPeopleSyncService: BannerPeopleSyncService) {}

  @Post('/spaiden-sync')
  async sync(@Body() body: unknown) {
    return this.bannerPeopleSyncService.sync(body);
  }
}
