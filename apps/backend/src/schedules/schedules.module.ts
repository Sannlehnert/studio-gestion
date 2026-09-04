import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessTimeModule } from '../time/business-time.module';
import { AdminSchedulesController } from './admin-schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
  imports: [AuthModule, BusinessTimeModule],
  controllers: [AdminSchedulesController],
  providers: [SchedulesService],
  exports: [SchedulesService],
})
export class SchedulesModule {}
