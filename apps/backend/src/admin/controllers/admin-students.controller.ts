import { ApiErrorDto } from '../../common/http/error-response.dto';
import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { AdminGuard } from '../../auth/guards/admin.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/types/auth.types';
import { StudentAuthService } from '../../auth/services/student-auth.service';
import { CreateStudentAccessDto } from '../../auth/dto/create-student-access.dto';
import {
  AccessResponseDto,
  EmptyBodyDto,
} from '../../auth/dto/auth-responses.dto';

@ApiTags('admin')
@ApiCookieAuth('session')
@UseGuards(AdminGuard)
@Controller('admin/students')
export class AdminStudentsController {
  constructor(private readonly auth: StudentAuthService) {}

  @Post(':studentId/access')
  @ApiOperation({ summary: 'Generar un acceso independiente para una alumna' })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiResponse({ status: 201, type: AccessResponseDto })
  @ApiResponse({
    type: ApiErrorDto,
    status: 404,
    description: 'Alumna no encontrada',
  })
  @ApiResponse({
    type: ApiErrorDto,
    status: 409,
    description: 'Alumna desactivada',
  })
  async createAccess(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Body() dto: CreateStudentAccessDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auth.createAccess(studentId, user.id, dto.expiresInDays ?? 7);
  }

  @Post(':studentId/access/:accessId/revoke')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Revocar un acceso pendiente; repetir la revocación es idempotente',
  })
  @ApiParam({ name: 'studentId', format: 'uuid' })
  @ApiParam({ name: 'accessId', format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Acceso revocado' })
  @ApiResponse({
    type: ApiErrorDto,
    status: 404,
    description: 'Acceso no encontrado para esta alumna',
  })
  @ApiResponse({
    type: ApiErrorDto,
    status: 409,
    description: 'Acceso ya activado; no revoca su sesión',
  })
  async revokeAccess(
    @Param('studentId', ParseUUIDPipe) studentId: string,
    @Param('accessId', ParseUUIDPipe) accessId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() _body: EmptyBodyDto,
  ) {
    await this.auth.revokeAccess(studentId, accessId, user.id);
  }
}
