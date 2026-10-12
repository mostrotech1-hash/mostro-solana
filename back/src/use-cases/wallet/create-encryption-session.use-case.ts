import { Inject, Injectable } from "@nestjs/common";
import type { EncryptionSessionResponse } from "@mostro/shared/api";
import { OpenfortService } from "../../modules/openfort/openfort.service";

@Injectable()
export class CreateEncryptionSessionUseCase {
   constructor(@Inject(OpenfortService) private readonly openfort: OpenfortService) {}

   async execute(): Promise<EncryptionSessionResponse> {
      return { session: await this.openfort.createEncryptionSession() };
   }
}
