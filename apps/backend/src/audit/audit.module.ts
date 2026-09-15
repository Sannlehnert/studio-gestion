import { Controller, Get, Module, Query, UseGuards } from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthModule } from '../auth/auth.module';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AuditService } from './audit.service';
import { AuditListResponseDto, AuditQueryDto } from './dto/audit.dto';
@ApiTags('admin-audit')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @ApiOperation({
    summary: 'Consultar auditoría operativa con metadata pública',
  })
  @ApiResponse({ status: 200, type: AuditListResponseDto })
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
@Module({
  imports: [AuthModule],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
