import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminPlansController } from './admin-plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminPlansController],
  providers: [PlansService],
  exports: [PlansService],
})
export class PlansModule {}
