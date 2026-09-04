import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessTimeModule } from '../time/business-time.module';
import {
  AdminEnrollmentsController,
  AdminScheduleEnrollmentsController,
  AdminStudentEnrollmentsController,
  AdminSubscriptionEnrollmentsController,
} from './admin-enrollments.controller';
import { EnrollmentsService } from './enrollments.service';

@Module({
  imports: [AuthModule, BusinessTimeModule],
  controllers: [
    AdminEnrollmentsController,
    AdminStudentEnrollmentsController,
    AdminSubscriptionEnrollmentsController,
    AdminScheduleEnrollmentsController,
  ],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
