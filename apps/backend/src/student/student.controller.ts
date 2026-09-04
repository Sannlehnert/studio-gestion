import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { RoleCheckResponseDto } from '../auth/dto/auth-responses.dto';
import { StudentGuard } from '../auth/guards/student.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/auth.types';

@ApiTags('student')
@ApiCookieAuth('session')
@Controller('student')
export class StudentController {
  @Get('check')
  @UseGuards(StudentGuard)
  @ApiOperation({ summary: 'Ruta de prueba protegida para estudiantes' })
  @ApiResponse({
    status: 200,
    description: 'Acceso permitido',
    type: RoleCheckResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  check(@CurrentUser() user: AuthenticatedUser) {
    return {
      message: 'Acceso de estudiante permitido',
      user,
    };
  }
}
