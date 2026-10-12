import { Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import type { EncryptionSessionResponse } from "@mostro/shared/api";
import { AuthGuard } from "../../common/auth.guard";
import { CreateEncryptionSessionUseCase } from "./create-encryption-session.use-case";

@Controller("wallet")
@UseGuards(AuthGuard)
export class WalletController {
   constructor(@Inject(CreateEncryptionSessionUseCase) private readonly createSession: CreateEncryptionSessionUseCase) {}

   @Post("encryption-session")
   @HttpCode(200)
   encryptionSession(): Promise<EncryptionSessionResponse> {
      return this.createSession.execute();
   }
}
