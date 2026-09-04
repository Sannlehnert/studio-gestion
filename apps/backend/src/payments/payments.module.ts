import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminPaymentsController,
  AdminSubscriptionPaymentsController,
} from './admin-payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule],
  controllers: [AdminPaymentsController, AdminSubscriptionPaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
