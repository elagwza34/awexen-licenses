import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthAdmin {
  id: number;
  email: string;
  name: string;
  roleKeys: string[];
  permissions: string[];
  sessionId?: number;
}

/** Injects the authenticated admin into a handler parameter. */
export const CurrentAdmin = createParamDecorator(
  (data: keyof AuthAdmin | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request & { admin?: AuthAdmin }>();
    const admin = request.admin;
    return data && admin ? admin[data] : admin;
  },
);

/** Injects the raw request (IP, user agent, requestId) for auditing. */
export const CurrentRequest = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<Request & { requestId?: string }>(),
);

/** Marks a route as public — skips the JWT guard. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declares the permissions required for a route.
 * ALL listed permissions are required (AND semantics).
 * `SUPER_ADMIN` bypasses this guard by design.
 */
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
