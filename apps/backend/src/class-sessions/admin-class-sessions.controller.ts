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
import { AdminGuard } from '../auth/guards/admin.guard';
import { AuthenticatedUser } from '../auth/types/auth.types';
import { ClassSessionsService } from './class-sessions.service';
import {
  CancelClassSessionDto,
  ClassSessionGenerationResponseDto,
  ClassSessionListResponseDto,
  ClassSessionResponseDto,
  ExpectedStudentsResponseDto,
  GenerateClassSessionsDto,
  ListClassSessionsQueryDto,
  UpdateClassSessionCapacityDto,
  UpdateClassSessionTimeDto,
} from './dto/class-session.dto';

@ApiTags('admin-class-sessions')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/class-sessions')
export class AdminClassSessionsController {
  constructor(private readonly classSessions: ClassSessionsService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generar clases idempotentemente para fechas locales',
  })
  @ApiResponse({ status: 200, type: ClassSessionGenerationResponseDto })
  generate(
    @Body() dto: GenerateClassSessionsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classSessions.generate(dto, actor.id);
  }

  @Get()
  @ApiOperation({ summary: 'Listar clases concretas' })
  @ApiResponse({ status: 200, type: ClassSessionListResponseDto })
  list(@Query() query: ListClassSessionsQueryDto) {
    return this.classSessions.list(query);
  }

  @Get(':id/expected-students')
  @ApiOperation({ summary: 'Derivar las alumnas esperadas para Attendance' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ExpectedStudentsResponseDto })
  expectedStudents(@Param('id', ParseUUIDPipe) id: string) {
    return this.classSessions.expectedStudents(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Consultar una clase concreta y su snapshot' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClassSessionResponseDto })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.classSessions.getById(id);
  }

  @Patch(':id/capacity')
  @ApiOperation({ summary: 'Cambiar la capacidad efectiva de una clase' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClassSessionResponseDto })
  updateCapacity(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassSessionCapacityDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classSessions.updateCapacity(id, dto, actor.id);
  }

  @Patch(':id/time')
  @ApiOperation({ summary: 'Aplicar una excepción horaria a una clase' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClassSessionResponseDto })
  updateTime(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateClassSessionTimeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classSessions.updateTime(id, dto, actor.id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancelar una clase con motivo e histórico' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: ClassSessionResponseDto })
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelClassSessionDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.classSessions.cancel(id, dto, actor.id);
  }
}
