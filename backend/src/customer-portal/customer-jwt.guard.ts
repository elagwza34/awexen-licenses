import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface CustomerSession {
  id: number;
  email: string;
  name: string;
}

declare module 'express' {
  interface Request {
    customer?: CustomerSession;
  }
}

/**
 * Guards the customer portal, and is the reason the two identity spaces stay
 * apart.
 *
 * A portal token is issued by the same JWT_ACCESS_SECRET as an admin token, so
 * signature verification alone cannot tell them apart. The audience claim is
 * what separates them: portal tokens carry `aud: 'customer-portal'` and admin
 * tokens carry `aud: 'owner-admin'`, and this guard accepts only the former.
 *
 * Without the audience check a portal token would satisfy the admin guard's
 * `typ === 'access'` test and open the panel that issues licences — a customer
 * password would escalate into full control. The admin guard is given the same
 * audience pin for the mirror-image case.
 */
@Injectable()
export class CustomerJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException('Sign in to continue.');

    let payload: { sub?: string | number; email?: string; name?: string; aud?: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        audience: 'customer-portal',
        issuer: 'awexen',
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new UnauthorizedException(expired ? 'Your session has expired.' : 'Invalid session.');
    }

    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) {
      throw new UnauthorizedException('Invalid session.');
    }

    request.customer = {
      id,
      email: payload.email ?? '',
      name: payload.name ?? '',
    };
    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7).trim();
    return undefined;
  }
}

/** Injects the signed-in customer into a handler parameter. */
export const CurrentCustomer = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CustomerSession => {
    const request = ctx.switchToHttp().getRequest<Request>();
    // The guard runs first on every route that uses this decorator, so
    // `customer` is always set. A defensive throw beats passing undefined into
    // a service that would then query with an undefined id.
    if (!request.customer) throw new UnauthorizedException('Sign in to continue.');
    return request.customer;
  },
);
