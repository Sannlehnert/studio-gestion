import { Module } from '@nestjs/common';
import { StudentController } from './student.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [AuthModule],
  controllers: [StudentController],
})
export class StudentModule {}
