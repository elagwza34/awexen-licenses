import { ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY, type AuthAdmin } from '../decorators';

@Injectable()
export class PermissionsGuard implements CanActivateLike {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { admin?: AuthAdmin }>();
    const admin = request.admin;

    if (!admin) {
      throw new ForbiddenException('Authentication required');
    }

    // Super admin is the escape hatch by design; every change is still audited.
    if (admin.roleKeys.includes('SUPER_ADMIN')) return true;

    const granted = new Set(admin.permissions);
    const missing = required.filter((p) => !granted.has(p));

    if (missing.length) {
      throw new ForbiddenException({
        message: 'You do not have permission to perform this action',
        details: { required, missing },
      });
    }

    return true;
  }
}

// Structural type so the file does not depend on Nest's CanActivate generics.
interface CanActivateLike {
  canActivate(context: ExecutionContext): boolean;
}
