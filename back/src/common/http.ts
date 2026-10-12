import { BadRequestException, ServiceUnavailableException, createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { z } from "zod";
import type { OpenfortIdentity } from "../modules/openfort/openfort.service";

/** The Openfort identity the AuthGuard attached to the request. */
export const CurrentIdentity = createParamDecorator((_data: unknown, ctx: ExecutionContext): OpenfortIdentity => {
   return ctx.switchToHttp().getRequest<Request & { identity: OpenfortIdentity }>().identity;
});

/** Validates a request body with zod and answers 400 with the first problem. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
   const result = schema.safeParse(body);
   if (!result.success) throw new BadRequestException(result.error.issues[0]?.message ?? "Invalid request.");
   return result.data;
}

/** A missing server key is a setup problem, not the caller's fault: 503 with a message that names nothing secret. */
export function requireConfigured(value: string | undefined, feature: string): string {
   if (!value) throw new ServiceUnavailableException(`${feature} is not configured on the server.`);
   return value;
}
