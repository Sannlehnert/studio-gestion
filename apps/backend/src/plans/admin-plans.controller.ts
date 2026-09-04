import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
  CreatePlanDto,
  ListPlansQueryDto,
  PlanListResponseDto,
  PlanResponseDto,
  UpdatePlanDto,
} from './dto/plan.dto';
import { PlansService } from './plans.service';

@ApiTags('admin-plans')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: PlansService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una oferta de plan activa' })
  @ApiResponse({ status: 201, type: PlanResponseDto })
  create(@Body() dto: CreatePlanDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.plans.create(dto, actor.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar, filtrar y buscar planes' })
  @ApiResponse({ status: 200, type: PlanListResponseDto })
  list(@Query() query: ListPlansQueryDto) {
    return this.plans.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar el detalle de un plan' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  @ApiResponse({ status: 404, description: 'Plan no encontrado' })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.plans.getById(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar campos del catálogo sin reescribir suscripciones',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.plans.update(id, dto, actor.id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar un plan de forma idempotente' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.plans.activate(id, actor.id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactivar un plan de forma idempotente' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: PlanResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.plans.deactivate(id, actor.id);
  }
}
