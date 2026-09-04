import { Injectable } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

@Injectable()
export class TokenService {
  generateToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  compareToken(plain: string, hash: string): boolean {
    const plainHash = this.hashToken(plain);
    const plainBuffer = Buffer.from(plainHash, 'hex');
    const hashBuffer = Buffer.from(hash, 'hex');

    if (plainBuffer.length !== hashBuffer.length) {
      return false;
    }

    return timingSafeEqual(plainBuffer, hashBuffer);
  }
}
