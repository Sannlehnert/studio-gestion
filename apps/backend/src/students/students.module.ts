import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { StudentsAdminController } from './admin-students.controller';
import { StudentsService } from './students.service';

@Module({
  imports: [AuthModule],
  controllers: [StudentsAdminController],
  providers: [StudentsService],
  exports: [StudentsService],
})
export class StudentsModule {}
