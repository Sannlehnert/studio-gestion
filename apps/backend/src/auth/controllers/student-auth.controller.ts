import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { StudentActivateDto } from '../dto/student-activate.dto';
import { StudentActivationResponseDto } from '../dto/auth-responses.dto';
import { StudentAuthService } from '../services/student-auth.service';
import { SessionCookieService } from '../services/session-cookie.service';

@ApiTags('auth')
@Controller('auth/student')
export class StudentAuthController {
  constructor(
    private readonly auth: StudentAuthService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Post('activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Consumir un acceso y crear sesión de alumna' })
  @ApiResponse({ status: 200, type: StudentActivationResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Acceso inválido, vencido, revocado o consumido',
  })
  async activate(
    @Body() dto: StudentActivateDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.activate(
      dto.token,
      req.ip,
      req.get('user-agent')?.slice(0, 512),
    );
    this.cookies.set(res, result.sessionToken, result.expiresAt);
    return { student: result.student, expiresAt: result.expiresAt };
  }
}
