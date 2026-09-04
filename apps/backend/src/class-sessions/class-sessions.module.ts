import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessTimeModule } from '../time/business-time.module';
import { AdminClassSessionsController } from './admin-class-sessions.controller';
import { ClassSessionsService } from './class-sessions.service';

@Module({
  imports: [AuthModule, BusinessTimeModule],
  controllers: [AdminClassSessionsController],
  providers: [ClassSessionsService],
  exports: [ClassSessionsService],
})
export class ClassSessionsModule {}
