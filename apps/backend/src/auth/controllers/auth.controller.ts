import {
  Body,
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { Request, Response } from 'express';
import { SessionGuard } from '../guards/session.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthenticatedUser } from '../types/auth.types';
import { EmptyBodyDto, MeResponseDto } from '../dto/auth-responses.dto';
import { SessionService } from '../services/session.service';
import { SessionCookieService } from '../services/session-cookie.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly sessions: SessionService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Get('me')
  @UseGuards(SessionGuard)
  @ApiCookieAuth('session')
  @ApiOperation({ summary: 'Obtener identidad desde la sesión' })
  @ApiResponse({ status: 200, type: MeResponseDto })
  @ApiResponse({ status: 401, description: 'No autenticado' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return { user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Logout idempotente: revocar sesión y limpiar cookie',
  })
  @ApiResponse({
    status: 204,
    description: 'Cookie limpiada; sesión revocada si existía',
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() _body: EmptyBodyDto,
  ) {
    const token = this.cookies.read(req);
    if (token) await this.sessions.revokeSession(token);
    this.cookies.clear(res);
  }
}
