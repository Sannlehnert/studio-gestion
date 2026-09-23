import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AdminGuard } from '../auth/guards/admin.guard';
import { StudentGuard } from '../auth/guards/student.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { EmptyBodyDto } from '../auth/dto/auth-responses.dto';
import { IntegrationReadsService } from './integration-reads.service';
import {
  AdminSubscriptionSummaryDto,
  AttendanceHistoryDto,
  HistoryQueryDto,
  ReadQueryDto,
  RecoveryOptionsDto,
  StudentHomeSummaryDto,
  UpcomingReadDto,
  UpcomingReadQueryDto,
} from './integration.dto';

@ApiTags('student-integration')
@ApiCookieAuth('session')
@UseGuards(StudentGuard)
@Controller('student')
export class StudentIntegrationController {
  constructor(private readonly reads: IntegrationReadsService) {}
  @Get('home-summary')
  @ApiOperation({
    summary:
      'Inicio propio: contrato contextual, próximas y tiempo del negocio; sin finanzas',
  })
  @ApiResponse({ status: 200, type: StudentHomeSummaryDto })
  home(@CurrentUser() user: AuthenticatedUser, @Query() _query: EmptyBodyDto) {
    return this.reads.home(user.id);
  }
  @Get('attendance-history')
  @ApiOperation({
    summary:
      'Historial propio persistido, estado efectivo y señal de corrección sin motivos internos',
  })
  @ApiResponse({ status: 200, type: AttendanceHistoryDto })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: HistoryQueryDto,
  ) {
    return this.reads.history(user.id, query);
  }
}

@ApiTags('admin-integration')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminIntegrationController {
  constructor(private readonly reads: IntegrationReadsService) {}
  @Get('students/:studentId/subscription-summary')
  @ApiOperation({
    summary: 'Contrato CURRENT/UPCOMING/NONE, consumo y finanzas de la alumna',
  })
  @ApiResponse({ status: 200, type: AdminSubscriptionSummaryDto })
  summary(
    @Param('studentId', ParseUUIDPipe) id: string,
    @Query() _query: EmptyBodyDto,
  ) {
    return this.reads.adminSummary(id);
  }
  @Get('students/:studentId/class-sessions/upcoming')
  @ApiOperation({
    summary: 'Próximas clases relevantes por pertenencia histórica y Recovery',
  })
  @ApiResponse({ status: 200, type: UpcomingReadDto })
  upcoming(
    @Param('studentId', ParseUUIDPipe) id: string,
    @Query() query: UpcomingReadQueryDto,
  ) {
    return this.reads.upcoming(id, query.limit);
  }
  @Get('students/:studentId/attendance-history')
  @ApiOperation({
    summary:
      'Historial persistido de la alumna; correcciones detalladas se consultan por Attendance',
  })
  @ApiResponse({ status: 200, type: AttendanceHistoryDto })
  history(
    @Param('studentId', ParseUUIDPipe) id: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.reads.history(id, query);
  }
  @Get('attendances/:attendanceId/recovery-options')
  @ApiOperation({
    summary:
      'Destinos válidos con capacidad real; lectura no reserva. POST puede devolver CLASS_SESSION_FULL.',
    description:
      'Rango predeterminado: hoy y siguientes 89 días; máximo 366 días y 1000 candidatas. Acotar fechas si se supera. Paginación después de elegibilidad.',
  })
  @ApiResponse({ status: 200, type: RecoveryOptionsDto })
  recovery(
    @Param('attendanceId', ParseUUIDPipe) id: string,
    @Query() query: ReadQueryDto,
  ) {
    return this.reads.recoveryOptions(id, query);
  }
}
