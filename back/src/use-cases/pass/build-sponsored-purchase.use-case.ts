import { BN } from "@coral-xyz/anchor";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { BuildPurchaseRequest, BuildPurchaseResponse } from "@mostro/shared/api";
import { listReceiptsByBuyer } from "@mostro/shared";
import { ENV, type Env } from "../../config/env";
import { RateLimiter, apiError } from "../../common/api-error";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { PurchaseTransactionBuilder } from "../../modules/solana/purchase-transaction.builder";
import { SolanaService } from "../../modules/solana/solana.service";
import { requireApprovedKyc } from "../kyc/require-kyc";
import { UserRepository } from "../users/user.repository";
import { requireOwnedWallet } from "./pass-wallet";

/** The sponsor must keep enough SOL for the rent of the accounts one purchase creates (token account, receipt, pass asset). */
const MIN_SPONSOR_LAMPORTS = 0.02 * LAMPORTS_PER_SOL;

/**
 * Step 1-7 of the sponsored flow. Everything the client sends is checked here: the wallet must belong to the user,
 * the quote is recomputed from the live curve, the user's approved limit is never exceeded, and the transaction is
 * built only from the fixed pass purchase (see `inspectPurchaseTransaction`).
 */
@Injectable()
export class BuildSponsoredPurchaseUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(ENV) private readonly env: Env,
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(SolanaService) private readonly solana: SolanaService,
      @Inject(PurchaseTransactionBuilder) private readonly builder: PurchaseTransactionBuilder,
   ) {}

   async execute(identity: OpenfortIdentity, request: BuildPurchaseRequest): Promise<BuildPurchaseResponse> {
      // The sponsor pays for what it signs, so how often one user can ask is limited.
      this.limiter.check(`${identity.openfortId}:burst`, 1, 2_000);
      this.limiter.check(`${identity.openfortId}:hour`, 20, 60 * 60_000);

      // Before anything is read from the chain or signed: no approved identity check, no purchase.
      await requireApprovedKyc(this.env, this.users, identity);
      const buyer = await requireOwnedWallet(this.openfort, identity, request.walletAddress);
      const approved = parseLamports(request.approvedMaxLamportsIn);

      const state = await this.solana.loadPassState();
      const { quote, config, curve, perk } = state;

      // Cheap checks first, with the program's own wording, so the user sees a clear reason instead of a failed transaction.
      if (config.buysPaused) throw new ConflictException("Buying is paused right now. Please try again later.");
      if (config.redeemsPaused) throw new ConflictException("Perk redemptions are paused right now. Please try again later.");
      if (await this.solana.isBlacklisted(buyer)) throw new ForbiddenException("This wallet is not allowed to use Mostro.");
      if (curve.complete) throw new ConflictException("The curve is complete. Trading here is closed.");
      if (!perk.active) throw new ConflictException("The pass is no longer available.");
      if (perk.maxSupply !== 0 && perk.sold >= perk.maxSupply) throw new ConflictException("Sold out. All passes have been claimed.");
      if (perk.publicStartTs.gt(new BN(Math.floor(Date.now() / 1000)))) throw new ConflictException("The pass sale has not opened yet.");

      // The curve moves with every purchase. If the new ceiling is above what the user approved, stop and let them review it.
      const maxLamportsIn = new BN(quote.maxLamportsIn);
      if (BigInt(quote.maxLamportsIn) > approved) {
         throw apiError(409, "QUOTE_CHANGED", "The price moved. Review the new price and confirm again.", { quote });
      }

      // The buyer pays only the trade; the system account must stay rent-exempt (or empty) afterwards.
      const rentFloor = BigInt(await this.solana.connection.getMinimumBalanceForRentExemption(0));
      const needed = BigInt(quote.maxLamportsIn) + rentFloor;
      const have = BigInt(await this.solana.connection.getBalance(buyer, "confirmed"));
      if (have < needed)
         throw apiError(409, "INSUFFICIENT_SOL", "Not enough SOL in your wallet for this purchase.", { neededLamports: needed.toString(), haveLamports: have.toString() });

      if (this.env.ENFORCE_ONE_PASS_PER_WALLET === "true") {
         const receipts = await listReceiptsByBuyer(this.solana.program, buyer);
         if (receipts.some((r) => r.account.perk.equals(state.perkAddress))) throw new ConflictException("This wallet already owns the pass.");
      }

      const sponsorBalance = await this.solana.connection.getBalance(this.solana.sponsor().publicKey, "confirmed");
      if (sponsorBalance < MIN_SPONSOR_LAMPORTS) throw apiError(503, "SPONSOR_UNAVAILABLE", "The fee sponsor is out of funds. Contact the team.");

      const built = await this.builder.build({ buyer, state, maxLamportsIn });

      return {
         transaction: built.serialized.toString("base64"),
         buyerSignatureIndex: built.buyerSignatureIndex,
         blockhash: built.blockhash,
         lastValidBlockHeight: built.lastValidBlockHeight,
         asset: built.asset.toBase58(),
         receipt: built.receipt.toBase58(),
         quote,
      };
   }
}

function parseLamports(value: string): bigint {
   if (!/^\d{1,20}$/.test(value)) throw new BadRequestException("Invalid approved amount.");
   return BigInt(value);
}
