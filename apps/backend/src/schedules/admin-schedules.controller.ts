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
  CreateScheduleDto,
  ListSchedulesQueryDto,
  ScheduleListResponseDto,
  ScheduleResponseDto,
  UpdateScheduleDto,
} from './dto/schedule.dto';
import { SchedulesService } from './schedules.service';

@ApiTags('admin-schedules')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/schedules')
export class AdminSchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Post()
  @ApiOperation({ summary: 'Crear un horario recurrente activo' })
  @ApiResponse({ status: 201, type: ScheduleResponseDto })
  create(
    @Body() dto: CreateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.schedules.create(dto, actor.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar horarios por estado y día ISO' })
  @ApiResponse({ status: 200, type: ScheduleListResponseDto })
  list(@Query() query: ListSchedulesQueryDto) {
    return this.schedules.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar un horario recurrente' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ScheduleResponseDto })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar sólo futuras generaciones del horario' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ScheduleResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.schedules.update(id, dto, actor.id);
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activar un horario de forma idempotente' })
  @ApiResponse({ status: 200, type: ScheduleResponseDto })
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.schedules.activate(id, actor.id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Desactivar un horario de forma idempotente' })
  @ApiResponse({ status: 200, type: ScheduleResponseDto })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.schedules.deactivate(id, actor.id);
  }
}
