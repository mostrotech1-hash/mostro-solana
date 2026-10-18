import { BN } from "@coral-xyz/anchor";
import { ConflictException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import type { BuildTokenPurchaseRequest, BuildTokenPurchaseResponse, TokenQuote } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";
import { RateLimiter, apiError } from "../../common/api-error";
import { OpenfortService, type OpenfortIdentity } from "../../modules/openfort/openfort.service";
import { SolanaService } from "../../modules/solana/solana.service";
import { TokenPurchaseBuilder } from "../../modules/solana/token-purchase.builder";
import { requireApprovedKyc } from "../kyc/require-kyc";
import { requireOwnedWallet } from "../pass/pass-wallet";
import { UserRepository } from "../users/user.repository";

/** The sponsor must keep enough SOL for the rent of what one purchase creates (token account, spend tracker). */
const MIN_SPONSOR_LAMPORTS = 0.02 * LAMPORTS_PER_SOL;

/** The live quote for `tokens` whole $MOST, read from the current curve. Never cached, never hardcoded. */
@Injectable()
export class GetTokenQuoteUseCase {
   constructor(@Inject(SolanaService) private readonly solana: SolanaService) {}

   async execute(tokens: number): Promise<TokenQuote> {
      return (await this.solana.loadTokenState(tokens)).quote;
   }
}

/**
 * Builds the sponsored "buy $MOST" transaction. Everything the client sends is checked here: the user must have an
 * approved identity check, the wallet must belong to the user, the quote is recomputed from the live curve, the user's
 * approved limit is never exceeded, and the transaction is built only in the fixed shape `inspectTokenPurchaseTransaction` allows.
 */
@Injectable()
export class BuildTokenPurchaseUseCase {
   private readonly limiter = new RateLimiter();

   constructor(
      @Inject(ENV) private readonly env: Env,
      @Inject(OpenfortService) private readonly openfort: OpenfortService,
      @Inject(UserRepository) private readonly users: UserRepository,
      @Inject(SolanaService) private readonly solana: SolanaService,
      @Inject(TokenPurchaseBuilder) private readonly builder: TokenPurchaseBuilder,
   ) {}

   async execute(identity: OpenfortIdentity, request: BuildTokenPurchaseRequest): Promise<BuildTokenPurchaseResponse> {
      this.limiter.check(`${identity.openfortId}:burst`, 1, 2_000);
      this.limiter.check(`${identity.openfortId}:hour`, 20, 60 * 60_000);

      // Before anything is read from the chain or signed: no approved identity check, no purchase.
      await requireApprovedKyc(this.env, this.users, identity);
      const buyer = await requireOwnedWallet(this.openfort, identity, request.walletAddress);
      const approved = BigInt(request.approvedMaxLamportsIn);

      const { config, curve, tokensOut, quote } = await this.solana.loadTokenState(request.tokens);

      // Cheap checks first, with the program's own wording, so the user sees a clear reason instead of a failed transaction.
      if (config.buysPaused) throw new ConflictException("Buying is paused right now. Please try again later.");
      if (await this.solana.isBlacklisted(buyer)) throw new ForbiddenException("This wallet is not allowed to use Mostro.");
      if (curve.complete) throw new ConflictException("The curve is complete. Trading here is closed.");
      if (curve.saleStartTs.gt(new BN(Math.floor(Date.now() / 1000)))) throw new ConflictException("The sale has not opened yet.");

      // The curve moves with every purchase. If the new ceiling is above what the user approved, stop and let them review it.
      if (BigInt(quote.maxLamportsIn) > approved) {
         throw apiError(409, "QUOTE_CHANGED", "The price moved. Review the new price and confirm again.", {});
      }

      // The buyer pays only the trade; the system account must stay rent-exempt (or empty) afterwards.
      const rentFloor = BigInt(await this.solana.connection.getMinimumBalanceForRentExemption(0));
      const needed = BigInt(quote.maxLamportsIn) + rentFloor;
      const have = BigInt(await this.solana.connection.getBalance(buyer, "confirmed"));
      if (have < needed)
         throw apiError(409, "INSUFFICIENT_SOL", "Not enough SOL in your wallet for this purchase.", { neededLamports: needed.toString(), haveLamports: have.toString() });

      const sponsorBalance = await this.solana.connection.getBalance(this.solana.sponsor().publicKey, "confirmed");
      if (sponsorBalance < MIN_SPONSOR_LAMPORTS) throw apiError(503, "SPONSOR_UNAVAILABLE", "The fee sponsor is out of funds. Contact the team.");

      const built = await this.builder.build({ buyer, tokensOut, maxLamportsIn: new BN(quote.maxLamportsIn) });
      return {
         transaction: built.serialized.toString("base64"),
         buyerSignatureIndex: built.buyerSignatureIndex,
         blockhash: built.blockhash,
         lastValidBlockHeight: built.lastValidBlockHeight,
         quote,
      };
   }
}
