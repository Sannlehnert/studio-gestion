import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieOptions, Response } from 'express';
import { getSettings } from '../../config/env.validation';

@Injectable()
export class SessionCookieService {
  constructor(private readonly config: ConfigService) {}

  read(request: { cookies?: unknown }): string | undefined {
    const cookies: unknown = request.cookies;
    if (!cookies || typeof cookies !== 'object') return undefined;
    const token: unknown = (cookies as Record<string, unknown>)[
      getSettings(this.config).cookieName
    ];
    return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
      ? token
      : undefined;
  }

  set(response: Response, token: string, expiresAt: Date): void {
    response.cookie(getSettings(this.config).cookieName, token, {
      ...this.options(),
      expires: expiresAt,
    });
  }

  clear(response: Response): void {
    response.clearCookie(getSettings(this.config).cookieName, this.options());
  }

  private options(): CookieOptions {
    return {
      httpOnly: true,
      secure: getSettings(this.config).cookieSecure,
      sameSite: 'lax',
      path: '/',
    };
  }
}
