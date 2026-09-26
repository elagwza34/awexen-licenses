import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC_KEY, type AuthAdmin } from '../decorators';

export interface JwtPayload {
  sub: number;
  email: string;
  name: string;
  roles: string[];
  perms: string[];
  sid?: number;
  typ: 'access';
}

@Injectable()
export class JwtAuthGuard {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { admin?: AuthAdmin }>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Access token is missing');
    }

    let payload: JwtPayload;
    try {
      // The audience is pinned, not just the signature. Admin and customer
      // tokens are signed with the same secret, so without this a customer
      // portal token would pass the `typ` check below and open the panel that
      // issues licences for every customer.
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        audience: 'owner-admin',
        issuer: 'awexen',
      });
    } catch (error) {
      const expired = error instanceof Error && error.name === 'TokenExpiredError';
      throw new UnauthorizedException(expired ? 'Access token expired' : 'Invalid access token');
    }

    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid token type');
    }

    request.admin = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      roleKeys: payload.roles ?? [],
      permissions: payload.perms ?? [],
      sessionId: payload.sid,
    };

    return true;
  }

  private extractToken(request: Request): string | undefined {
    const header = request.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7).trim();
    return undefined;
  }
}
