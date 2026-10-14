import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { PrepareMoonpayRequest, PrepareMoonpayResponse } from "@mostro/shared/api";
import { MoonpayUrlService } from "../../modules/moonpay/moonpay-url.service";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { requireOwnedWallet } from "../pass/pass-wallet";
import { UserRepository } from "../users/user.repository";

@Injectable()
export class PrepareWidgetUseCase {
   constructor(
      @Inject(MoonpayUrlService) private readonly moonpay: MoonpayUrlService,
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
   ) {}

   async execute(identity: OpenfortIdentity, request: PrepareMoonpayRequest, clientIp: string | null): Promise<PrepareMoonpayResponse> {
      const user = await this.users.findByOpenfortId(identity.openfortId);
      if (!user) throw new NotFoundException("Unknown user. Sync the user first.");
      await requireOwnedWallet(this.openfort, identity, request.walletAddress);
      return this.moonpay.prepare({ ...request, externalCustomerId: user.id, clientIp }, identity.openfortId);
   }
}
