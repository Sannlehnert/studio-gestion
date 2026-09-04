import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiCookieAuth,
} from '@nestjs/swagger';
import { RoleCheckResponseDto } from '../auth/dto/auth-responses.dto';
import { AdminGuard } from '../auth/guards/admin.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/auth.types';

@ApiTags('admin')
@ApiCookieAuth('session')
@Controller('admin')
export class AdminController {
  @Get('check')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Ruta de prueba protegida para administradores' })
  @ApiResponse({
    status: 200,
    description: 'Acceso permitido',
    type: RoleCheckResponseDto,
  })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  @ApiResponse({ status: 403, description: 'No autorizado' })
  check(@CurrentUser() user: AuthenticatedUser) {
    return {
      message: 'Acceso de administrador permitido',
      user,
    };
  }
}
