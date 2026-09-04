import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassSessionsModule } from '../class-sessions/class-sessions.module';
import { BusinessTimeModule } from '../time/business-time.module';
import { AdminAttendanceController } from './admin-attendance.controller';
import { AttendanceReconciliationScheduler } from './attendance-reconciliation.scheduler';
import { AttendanceService } from './attendance.service';
import { StudentAttendanceController } from './student-attendance.controller';

@Module({
  imports: [AuthModule, BusinessTimeModule, ClassSessionsModule],
  controllers: [AdminAttendanceController, StudentAttendanceController],
  providers: [AttendanceService, AttendanceReconciliationScheduler],
  exports: [AttendanceService],
})
export class AttendanceModule {}
