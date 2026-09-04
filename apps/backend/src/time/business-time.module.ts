import { Module } from '@nestjs/common';
import { BusinessTimeService } from './business-time.service';

@Module({
  providers: [BusinessTimeService],
  exports: [BusinessTimeService],
})
export class BusinessTimeModule {}
