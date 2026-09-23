import { ApiErrorDto } from '../common/http/error-response.dto';
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
import { EmptyBodyDto } from '../auth/dto/auth-responses.dto';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import {
  CreateSubscriptionDto,
  FinancialSummaryResponseDto,
  ListSubscriptionsQueryDto,
  SubscriptionDetailResponseDto,
  SubscriptionListResponseDto,
  SubscriptionResponseDto,
} from './dto/subscription.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('admin-subscriptions')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una suscripción con snapshot contractual' })
  @ApiResponse({ status: 201, type: SubscriptionResponseDto })
  @ApiResponse({
    type: ApiErrorDto,
    status: 409,
    description: 'Estado u período incompatible',
  })
  create(
    @Body() dto: CreateSubscriptionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.subscriptions.create(dto, actor.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar suscripciones con estado operativo' })
  @ApiResponse({ status: 200, type: SubscriptionListResponseDto })
  list(@Query() query: ListSubscriptionsQueryDto) {
    return this.subscriptions.list(query);
  }

  @Get(':id/financial-summary')
  @ApiOperation({ summary: 'Obtener el estado financiero derivado' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: FinancialSummaryResponseDto })
  financialSummary(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.financialSummary(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar contrato y resumen financiero' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: SubscriptionDetailResponseDto })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.subscriptions.getById(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una suscripción de forma idempotente' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.subscriptions.cancel(id, actor.id);
  }
}

@ApiTags('admin-subscriptions')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/students/:studentId/subscriptions')
export class AdminStudentSubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar suscripciones de una alumna' })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiResponse({ status: 200, type: SubscriptionListResponseDto })
  list(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Query() query: ListSubscriptionsQueryDto,
  ) {
    return this.subscriptions.listForStudent(studentId, query);
  }
}
