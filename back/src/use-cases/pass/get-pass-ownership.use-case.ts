import { Inject, Injectable } from "@nestjs/common";
import type { PassOwnershipResponse } from "@mostro/shared/api";
import { listReceiptsByBuyer } from "@mostro/shared";
import { RateLimiter } from "../../common/api-error";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { SolanaService } from "../../modules/solana/solana.service";
import { requireOwnedWallet } from "./pass-wallet";

/** Tells the app whether this wallet already holds the pass, from the receipts on the chain (so a returning user skips the purchase). */
@Injectable()
export class GetPassOwnershipUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
      @Inject(SolanaService) private readonly solana: SolanaService,
   ) {}

   async execute(identity: OpenfortIdentity, walletAddress: string): Promise<PassOwnershipResponse> {
      this.limiter.check(`${identity.openfortId}:ownership`, 60, 60_000);
      const buyer = await requireOwnedWallet(this.openfort, identity, walletAddress);
      const { perkAddress } = await this.solana.loadPassState();
      const receipts = (await listReceiptsByBuyer(this.solana.program, buyer)).filter((r) => r.account.perk.equals(perkAddress));
      const latest = receipts.sort((a, b) => b.account.edition - a.account.edition)[0];
      if (!latest) return { owned: false };
      return { owned: true, edition: latest.account.edition, asset: latest.account.asset.toBase58(), receipt: latest.publicKey.toBase58() };
   }
}
