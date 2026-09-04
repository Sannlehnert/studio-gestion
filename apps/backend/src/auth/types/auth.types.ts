import { SessionRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  role: SessionRole;
  email?: string; // solo para admin
  fullName?: string; // solo para student
}

export interface SessionPayload {
  sessionId: string;
  userId: string;
  role: SessionRole;
  expiresAt: Date;
}
