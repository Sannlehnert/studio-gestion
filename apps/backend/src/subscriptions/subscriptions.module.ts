import { BusinessTimeModule } from '../time/business-time.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminStudentSubscriptionsController,
  AdminSubscriptionsController,
} from './admin-subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [AuthModule, BusinessTimeModule],
  controllers: [
    AdminSubscriptionsController,
    AdminStudentSubscriptionsController,
  ],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
