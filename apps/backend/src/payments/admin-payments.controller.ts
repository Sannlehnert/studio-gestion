import {
  Body,
  Controller,
  Get,
  Headers,
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
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AdminGuard } from '../auth/guards/admin.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import {
  ListPaymentsQueryDto,
  PaymentListResponseDto,
  PaymentResponseDto,
  RegisterPaymentDto,
  VoidPaymentDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@ApiTags('admin-payments')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Listar pagos preservando anulaciones' })
  @ApiResponse({ status: 200, type: PaymentListResponseDto })
  list(@Query() query: ListPaymentsQueryDto) {
    return this.payments.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar el detalle de un pago' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.payments.getById(id);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Anular un pago de forma trazable e idempotente' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  void(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidPaymentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payments.void(id, dto, actor.id);
  }
}

@ApiTags('admin-payments')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/subscriptions/:subscriptionId/payments')
export class AdminSubscriptionPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Registrar dinero recibido para una suscripción' })
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID v4 estable para reintentos del mismo registro',
  })
  @ApiResponse({ status: 201, type: PaymentResponseDto })
  @ApiResponse({ status: 409, description: 'Sobrepago o clave reutilizada' })
  register(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Body() dto: RegisterPaymentDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payments.register(
      subscriptionId,
      dto,
      actor.id,
      idempotencyKey,
    );
  }

  @Get()
  @ApiOperation({ summary: 'Listar pagos de una suscripción' })
  @ApiParam({ name: 'subscriptionId', format: 'uuid' })
  @ApiResponse({ status: 200, type: PaymentListResponseDto })
  list(
    @Param('subscriptionId', ParseUUIDPipe) subscriptionId: string,
    @Query() query: ListPaymentsQueryDto,
  ) {
    return this.payments.listForSubscription(subscriptionId, query);
  }
}
