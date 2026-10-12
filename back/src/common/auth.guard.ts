import { Inject, Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { OpenfortService, type OpenfortIdentity } from "../modules/openfort/openfort.service";

/** Every route is private: the caller sends its Openfort access token as `Authorization: Bearer <token>`, and Openfort vouches for who it is. */
@Injectable()
export class AuthGuard implements CanActivate {
   constructor(@Inject(OpenfortService) private readonly openfort: OpenfortService) {}

   async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<Request & { identity?: OpenfortIdentity }>();
      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
      if (!token) throw new UnauthorizedException("Missing access token.");
      request.identity = await this.openfort.verifyAccessToken(token);
      return true;
   }
}
