import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessTimeModule } from '../time/business-time.module';
import { StudentsAdminController } from './admin-students.controller';
import { StudentStatusHistoryService } from './student-status-history.service';
import { StudentsService } from './students.service';

@Module({
  imports: [AuthModule, BusinessTimeModule],
  controllers: [StudentsAdminController],
  providers: [StudentsService, StudentStatusHistoryService],
  exports: [StudentsService, StudentStatusHistoryService],
})
export class StudentsModule {}
