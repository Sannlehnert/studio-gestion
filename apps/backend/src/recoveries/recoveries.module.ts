import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClassSessionsModule } from '../class-sessions/class-sessions.module';
import { StudentsModule } from '../students/students.module';
import { BusinessTimeModule } from '../time/business-time.module';
import { RecoveriesService } from './recoveries.service';
import {
  AdminRecoveriesController,
  StudentRecoveriesController,
} from './recoveries.controller';

@Module({
  imports: [
    AuthModule,
    ClassSessionsModule,
    StudentsModule,
    BusinessTimeModule,
  ],
  providers: [RecoveriesService],
  controllers: [AdminRecoveriesController, StudentRecoveriesController],
  exports: [RecoveriesService],
})
export class RecoveriesModule {}
