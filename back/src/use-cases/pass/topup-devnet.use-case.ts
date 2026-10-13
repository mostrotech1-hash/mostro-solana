import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import type { DevnetTopupRequest, DevnetTopupResponse } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";
import { RateLimiter } from "../../common/api-error";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { SolanaService } from "../../modules/solana/solana.service";
import { requireOwnedWallet } from "./pass-wallet";

/** The sponsor always keeps a reserve for the rent of the passes it sponsors. */
const SPONSOR_RESERVE_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;

/**
 * DEVNET ONLY. MoonPay test mode delivers 1/100 of the card amount, so the buyer's wallet is usually a little short.
 * This sends a fixed amount (default 0.15 SOL, the MoonPay minimum) from the sponsor wallet to the user's own wallet, only when
 * the wallet is short, so the demo behaves like a real card purchase and can finish. The extra stays in the wallet.
 */
@Injectable()
export class TopupDevnetUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(ENV) private readonly env: Env,
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
      @Inject(SolanaService) private readonly solana: SolanaService,
   ) {}

   async execute(identity: OpenfortIdentity, request: DevnetTopupRequest): Promise<DevnetTopupResponse> {
      if (this.env.DEVNET_TOPUP_ENABLED !== "true") throw new ForbiddenException("Devnet top-up is disabled.");
      this.limiter.check(`${identity.openfortId}:burst`, 1, 20_000);
      this.limiter.check(`${identity.openfortId}:hour`, 5, 60 * 60_000);

      const buyer = await requireOwnedWallet(this.openfort, identity, request.walletAddress);
      const { quote } = await this.solana.loadPassState();
      const { connection } = this.solana;

      const rentFloor = BigInt(await connection.getMinimumBalanceForRentExemption(0));
      const needed = BigInt(quote.maxLamportsIn) + rentFloor;
      const have = BigInt(await connection.getBalance(buyer, "confirmed"));
      if (have >= needed) return { toppedUpLamports: "0", signature: null };

      const shortfall = needed - have;
      const amount = BigInt(this.env.DEVNET_TOPUP_LAMPORTS);
      if (shortfall > amount) throw new ConflictException("The missing amount is too large for a devnet top-up.");

      const sponsor = this.solana.sponsor();
      const sponsorBalance = BigInt(await connection.getBalance(sponsor.publicKey, "confirmed"));
      if (sponsorBalance < amount + BigInt(SPONSOR_RESERVE_LAMPORTS)) throw new ConflictException("The sponsor wallet cannot cover a top-up right now.");

      const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: buyer, lamports: amount }));
      const signature = await sendAndConfirmTransaction(connection, tx, [sponsor], { commitment: "confirmed" });
      return { toppedUpLamports: amount.toString(), signature };
   }
}
