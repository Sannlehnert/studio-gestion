import { Module } from '@nestjs/common';
import { BusinessTimeService } from './business-time.service';
import { CLOCK, SystemClock } from './clock';

@Module({
  providers: [
    BusinessTimeService,
    SystemClock,
    { provide: CLOCK, useExisting: SystemClock },
  ],
  exports: [BusinessTimeService, CLOCK],
})
export class BusinessTimeModule {}
