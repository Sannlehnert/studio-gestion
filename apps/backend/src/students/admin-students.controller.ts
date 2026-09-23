import { ApiErrorDto } from '../common/http/error-response.dto';
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
import { EmptyBodyDto } from '../auth/dto/auth-responses.dto';
import { ListStudentsQueryDto } from './dto/list-students-query.dto';
import {
  StudentListResponseDto,
  StudentResponseDto,
} from './dto/student-responses.dto';
import { CreateStudentDto, UpdateStudentDto } from './dto/student-name.dto';
import { StudentsService } from './students.service';

@ApiTags('admin-students')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/students')
export class StudentsAdminController {
  constructor(private readonly students: StudentsService) {}

  @Post()
  @ApiOperation({ summary: 'Crear una alumna activa' })
  @ApiResponse({ status: 201, type: StudentResponseDto })
  create(
    @Body() dto: CreateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.create(dto.fullName, actor.id);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar y buscar alumnas con paginación por página',
  })
  @ApiResponse({ status: 200, type: StudentListResponseDto })
  list(@Query() query: ListStudentsQueryDto) {
    return this.students.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Obtener una alumna por ID' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: StudentResponseDto })
  @ApiResponse({
    type: ApiErrorDto,
    status: 404,
    description: 'Alumna no encontrada',
  })
  getById(@Param('id', ParseUUIDPipe) id: string) {
    return this.students.getById(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modificar el nombre de una alumna' })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: StudentResponseDto })
  @ApiResponse({
    type: ApiErrorDto,
    status: 404,
    description: 'Alumna no encontrada',
  })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStudentDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.students.update(id, dto.fullName, actor.id);
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Desactivar una alumna y revocar sesiones y accesos pendientes',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: StudentResponseDto })
  @ApiResponse({
    type: ApiErrorDto,
    status: 404,
    description: 'Alumna no encontrada',
  })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.students.deactivate(id, actor.id);
  }

  @Post(':id/reactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reactivar una alumna sin revivir credenciales anteriores',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiResponse({ status: 200, type: StudentResponseDto })
  @ApiResponse({
    type: ApiErrorDto,
    status: 404,
    description: 'Alumna no encontrada',
  })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    return this.students.reactivate(id, actor.id);
  }
}
