import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";

import type { TenantContext } from "../../database/database.service";
import type { AccessTokenClaims } from "../services/token.service";
import { TokenService } from "../services/token.service";

/** Marks a route as reachable without a token. */
export const IS_PUBLIC = "isPublic";
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Restricts a route to staff or consumer principals. */
export const PRINCIPAL_KIND = "principalKind";
export const StaffOnly = () => SetMetadata(PRINCIPAL_KIND, "staff");
export const ContactOnly = () => SetMetadata(PRINCIPAL_KIND, "contact");

/** The authenticated principal, attached to the request by the guard. */
export interface AuthenticatedRequest extends Request {
  principal?: AccessTokenClaims;
  tenant?: TenantContext;
}

/**
 * Bearer-token guard.
 *
 * Also derives the RLS `TenantContext` from the verified claims and attaches it to the request,
 * so controllers never construct one by hand. That matters: an org id assembled from a header or
 * a body field would be attacker-controlled, whereas this one comes from a signed token.
 *
 * ⚠️ `isPlatformAdmin` is deliberately hard-coded false here. Platform admin grants read across
 * every tenant, so it must be an explicit, separately-audited decision — never something a role
 * claim can flip on its own. Wire it when the admin surface is built, with its own guard.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.tokens.verifyAccessToken(header.slice("Bearer ".length).trim());
    } catch {
      // Expired and malformed are the same answer — the client's action is identical either way.
      throw new UnauthorizedException("Invalid or expired token");
    }

    const required = this.reflector.getAllAndOverride<"staff" | "contact" | undefined>(
      PRINCIPAL_KIND,
      [context.getHandler(), context.getClass()],
    );

    if (required && claims.kind !== required) {
      throw new UnauthorizedException("Invalid or expired token");
    }

    request.principal = claims;
    request.tenant = {
      organizationId: claims.org,
      isPlatformAdmin: false,
    };

    return true;
  }
}
