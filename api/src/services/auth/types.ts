import type { Session } from 'better-auth/types';
import type { UserWithTwoFactor } from 'better-auth/plugins/two-factor';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserWithTwoFactor | null;
    session: Session | null;
  }
}

export {};
