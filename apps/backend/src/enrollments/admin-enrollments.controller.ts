import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import {
  ChangeEnrollmentScheduleDto,
  CreateEnrollmentDto,
  EndEnrollmentDto,
  EnrollmentChangeResponseDto,
  EnrollmentListResponseDto,
  EnrollmentResponseDto,
  ListEnrollmentsQueryDto,
} from './dto/enrollment.dto';
import { EnrollmentsService } from './enrollments.service';

@ApiTags('admin-enrollments')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/enrollments')
export class AdminEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Inscribir una alumna en un horario por vigencia' })
  @ApiResponse({ status: 201, type: EnrollmentResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Vigencia, cupo o relación inválida',
  })
  create(
    @Body() dto: CreateEnrollmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.enrollments.create(dto, actor.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar una inscripción histórica' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: EnrollmentResponseDto })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.enrollments.getById(id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finalizar anticipadamente una inscripción' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: EnrollmentResponseDto })
  end(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndEnrollmentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.enrollments.end(id, dto, actor.id);
  }

  @Post(':id/change-schedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cambiar de horario preservando ambas vigencias' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: EnrollmentChangeResponseDto })
  changeSchedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeEnrollmentScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.enrollments.changeSchedule(id, dto, actor.id);
  }
}

@ApiTags('admin-enrollments')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/students/:studentId/enrollments')
export class AdminStudentEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar inscripciones de una alumna' })
  @ApiResponse({ status: 200, type: EnrollmentListResponseDto })
  list(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: ListEnrollmentsQueryDto,
  ) {
    return this.enrollments.list({ kind: 'student', id: studentId }, query);
  }
}

@ApiTags('admin-enrollments')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/subscriptions/:subscriptionId/enrollments')
export class AdminSubscriptionEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar inscripciones de una suscripción' })
  @ApiResponse({ status: 200, type: EnrollmentListResponseDto })
  list(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Query() query: ListEnrollmentsQueryDto,
  ) {
    return this.enrollments.list(
      { kind: 'subscription', id: subscriptionId },
      query,
    );
  }
}

@ApiTags('admin-enrollments')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/schedules/:scheduleId/enrollments')
export class AdminScheduleEnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar inscripciones de un horario' })
  @ApiResponse({ status: 200, type: EnrollmentListResponseDto })
  list(
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Query() query: ListEnrollmentsQueryDto,
  ) {
    return this.enrollments.list({ kind: 'schedule', id: scheduleId }, query);
  }
}
