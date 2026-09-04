import { Module } from '@nestjs/common';
import { TokenService } from './services/token.service';
import { PasswordService } from './services/password.service';
import { SessionService } from './services/session.service';
import { AdminAuthService } from './services/admin-auth.service';
import { StudentAuthService } from './services/student-auth.service';
import { SessionGuard } from './guards/session.guard';
import { AdminGuard } from './guards/admin.guard';
import { StudentGuard } from './guards/student.guard';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { StudentAuthController } from './controllers/student-auth.controller';
import { AuthController } from './controllers/auth.controller';
import { SessionCookieService } from './services/session-cookie.service';

@Module({
  controllers: [AdminAuthController, StudentAuthController, AuthController],
  providers: [
    SessionCookieService,
    TokenService,
    PasswordService,
    SessionService,
    AdminAuthService,
    StudentAuthService,
    SessionGuard,
    AdminGuard,
    StudentGuard,
  ],
  exports: [
    SessionCookieService,
    TokenService,
    PasswordService,
    SessionService,
    AdminAuthService,
    StudentAuthService,
    SessionGuard,
    AdminGuard,
    StudentGuard,
  ],
})
export class AuthModule {}
