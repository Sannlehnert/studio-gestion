import { AuditModule } from './audit/audit.module';
import { IntegrationReadsModule } from './integration-reads/integration-reads.module';
import { RecoveriesModule } from './recoveries/recoveries.module';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validate } from './config/env.validation';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { StudentModule } from './student/student.module';
import { StudentsModule } from './students/students.module';
import { PlansModule } from './plans/plans.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { PaymentsModule } from './payments/payments.module';
import { SchedulesModule } from './schedules/schedules.module';
import { EnrollmentsModule } from './enrollments/enrollments.module';
import { ClassSessionsModule } from './class-sessions/class-sessions.module';
import { AttendanceModule } from './attendance/attendance.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: process.env.NODE_ENV === 'test',
      validate,
    }),
    PrismaModule,
    AuthModule,
    AdminModule,
    StudentModule,
    StudentsModule,
    PlansModule,
    SubscriptionsModule,
    PaymentsModule,
    SchedulesModule,
    EnrollmentsModule,
    ClassSessionsModule,
    AttendanceModule,
    RecoveriesModule,
    AuditModule,
    IntegrationReadsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
