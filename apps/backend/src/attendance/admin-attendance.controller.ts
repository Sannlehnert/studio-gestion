import { AttendanceCorrectionsService } from './attendance-corrections.service';
import {
  ManualAttendanceDto,
  CorrectAttendanceDto,
  CorrectAttendanceResponseDto,
  AttendanceCorrectionListDto,
} from './dto/attendance-correction.dto';
import { PageQueryDto } from '../audit/dto/audit.dto';
import { MarkAttendanceResponseDto } from './dto/attendance.dto';
import {
  Body,
  Query,
  HttpCode,
  Post,
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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { EmptyBodyDto } from '../auth/dto/auth-responses.dto';
import { AttendanceChallengeService } from './attendance-challenge.service';
import { AttendanceRateGuard } from './attendance-rate.guard';
import { AttendanceChallengeResponseDto } from './dto/attendance-challenge.dto';
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
  constructor(
    private readonly attendance: AttendanceService,
    private readonly corrections: AttendanceCorrectionsService,
    private readonly challenges: AttendanceChallengeService,
  ) {}

  @Post('class-sessions/:classSessionId/students/:studentId/attendance')
  @ApiOperation({
    summary:
      'Registrar PRESENT manual durante la ventana; sin QR; no sobrescribe Attendance existente',
  })
  @ApiParam({ name: 'classSessionId', format: 'uuid' })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiResponse({ status: 201, type: MarkAttendanceResponseDto })
  manual(
    @Param('classSessionId', ParseUUIDPipe) classSessionId: string,
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: ManualAttendanceDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.attendance.markManualPresent(
      classSessionId,
      studentId,
      dto.reason,
      admin.id,
    );
  }

  @Post('attendances/:attendanceId/corrections')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Corregir PRESENT/ABSENT conservando origen y consumo; no-op sin nuevo historial',
  })
  @ApiParam({ name: 'attendanceId', format: 'uuid' })
  @ApiResponse({ status: 200, type: CorrectAttendanceResponseDto })
  correct(
    @Param('attendanceId', ParseUUIDPipe) id: string,
    @Body() dto: CorrectAttendanceDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.corrections.correct(id, dto.targetStatus, dto.reason, admin.id);
  }

  @Get('attendances/:attendanceId/corrections')
  @ApiOperation({
    summary:
      'Historial inmutable de correcciones, ordenado por secuencia ascendente',
  })
  @ApiParam({ name: 'attendanceId', format: 'uuid' })
  @ApiResponse({ status: 200, type: AttendanceCorrectionListDto })
  history(
    @Param('attendanceId', ParseUUIDPipe) id: string,
    @Query() query: PageQueryDto,
  ) {
    return this.corrections.history(id, query);
  }

  @Post('class-sessions/:classSessionId/qr-challenge')
  @UseGuards(AttendanceRateGuard)
  @ApiOperation({
    summary: 'Emitir un challenge QR temporal para una clase abierta',
  })
  @ApiParam({ name: 'classSessionId', format: 'uuid' })
  @ApiResponse({ status: 201, type: AttendanceChallengeResponseDto })
  issueChallenge(
    @Param('classSessionId', ParseUUIDPipe) classSessionId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.challenges.issue(classSessionId, admin.id);
  }

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
