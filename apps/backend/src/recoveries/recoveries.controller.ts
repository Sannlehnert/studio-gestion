import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { RecoveriesService } from './recoveries.service';
import {
  AdminRecoveryQueryDto,
  AuthorizeRecoveryDto,
  CancelRecoveryDto,
  RecoveryListResponseDto,
  RecoveryResponseDto,
  StudentRecoveryQueryDto,
} from './dto/recovery.dto';

@ApiTags('admin-recoveries')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminRecoveriesController {
  constructor(private readonly recoveries: RecoveriesService) {}
  @Post('attendances/:attendanceId/recovery')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Autorizar Recovery desde ABSENT; replay lógico devuelve la misma autorización',
  })
  @ApiResponse({ status: 200, type: RecoveryResponseDto })
  authorize(
    @Param('attendanceId', ParseUUIDPipe) id: string,
    @Body() body: AuthorizeRecoveryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.recoveries.authorize(id, body.targetClassSessionId, admin.id);
  }
  @Post('recoveries/:id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cancelar una autorización sin Attendance con motivo; idempotente',
  })
  @ApiResponse({ status: 200, type: RecoveryResponseDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CancelRecoveryDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.recoveries.cancel(id, body.reason, admin.id);
  }
  @Get('recoveries')
  @ApiOperation({
    summary: 'Listar Recoveries por alumna, ausencia o cancelación manual',
  })
  @ApiResponse({ status: 200, type: RecoveryListResponseDto })
  list(@Query() query: AdminRecoveryQueryDto) {
    return this.recoveries.list(query);
  }
  @Get('recoveries/:id')
  @ApiOperation({
    summary: 'Consultar autorización, resultado e indisponibilidad',
  })
  @ApiResponse({ status: 200, type: RecoveryResponseDto })
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.recoveries.get(id);
  }
}

@ApiTags('student-recoveries')
@ApiCookieAuth('session')
@UseGuards(StudentGuard)
@Controller('student/recoveries')
export class StudentRecoveriesController {
  constructor(private readonly recoveries: RecoveriesService) {}
  @Get()
  @ApiOperation({ summary: 'Consultar únicamente Recoveries propias' })
  @ApiResponse({ status: 200, type: RecoveryListResponseDto })
  list(
    @Query() query: StudentRecoveryQueryDto,
    @CurrentUser() student: AuthenticatedUser,
  ) {
    return this.recoveries.list(query, student.id);
  }
  @Get(':id')
  @ApiOperation({ summary: 'Consultar una Recovery propia' })
  @ApiResponse({ status: 200, type: RecoveryResponseDto })
  get(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() student: AuthenticatedUser,
  ) {
    return this.recoveries.get(id, student.id);
  }
}
