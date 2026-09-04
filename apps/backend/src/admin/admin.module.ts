import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminStudentsController } from './controllers/admin-students.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [AdminController, AdminStudentsController],
})
export class AdminModule {}
