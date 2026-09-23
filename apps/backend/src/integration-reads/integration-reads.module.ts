import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BusinessTimeModule } from '../time/business-time.module';
import { ClassSessionsModule } from '../class-sessions/class-sessions.module';
import { IntegrationReadsService } from './integration-reads.service';
import {
  AdminIntegrationController,
  StudentIntegrationController,
} from './integration-reads.controller';

@Module({
  imports: [AuthModule, BusinessTimeModule, ClassSessionsModule],
  providers: [IntegrationReadsService],
  controllers: [AdminIntegrationController, StudentIntegrationController],
})
export class IntegrationReadsModule {}
