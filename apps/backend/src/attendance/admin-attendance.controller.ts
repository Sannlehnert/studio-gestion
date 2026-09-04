import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AttendanceService } from './attendance.service';
import {
  AdminClassAttendanceResponseDto,
  ClassAllowanceSummaryDto,
} from './dto/attendance.dto';

@ApiTags('admin-attendance')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminAttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('class-sessions/:classSessionId/attendance')
  @ApiOperation({
    summary: 'Consultar expected, presentes, ausentes y pendientes',
  })
  @ApiParam({ name: 'classSessionId', format: 'uuid' })
  @ApiResponse({ status: 200, type: AdminClassAttendanceResponseDto })
  getClassAttendance(
    @Param('classSessionId', ParseUUIDPipe) classSessionId: string,
  ) {
    return this.attendance.getAdminClassAttendance(classSessionId);
  }

  @Get('subscriptions/:subscriptionId/class-summary')
  @ApiOperation({ summary: 'Consultar consumo derivado de una suscripción' })
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClassAllowanceSummaryDto })
  classSummary(@Param('subscriptionId', ParseUUIDPipe) subscriptionId: string) {
    return this.attendance.getClassSummary(subscriptionId);
  }
}
