import { Inject, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";
import devnetAddresses from "@mostro/shared/addresses/devnet";
import { artistPda, createReadonlyProgram, fetchConfig, fetchCurve, isBlacklisted, maxIn, perkKindName, perkPda, quoteBuyExactOut, type MostroProgram } from "@mostro/shared";
import type { PassQuote, TokenQuote } from "@mostro/shared/api";
import { ENV, type Env } from "../../config/env";
import { apiError } from "../../common/api-error";

/** The demo pass: artist #0, perk #0 ("Mostro Pass Classic", 1,200 $MOST). Perk #1 (VIP) is never used here. */
export const DEMO_PASS = {
   curveIndex: 0,
   artistIndex: 0,
   perkIndex: 0,
   name: "Mostro Pass Classic",
   /** Exactly 1,200 $MOST in base units (6 decimals). */
   priceBaseUnits: 1_200_000_000n,
   slippageBps: 100,
   computeUnits: 250_000,
} as const;

const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

/** $MOST has 6 decimals: one whole token is this many base units. */
export const TOKEN_BASE_UNITS = 1_000_000n;

type ConfigAccount = Awaited<ReturnType<typeof fetchConfig>>;
type CurveAccount = Awaited<ReturnType<typeof fetchCurve>>;
type PerkAccount = Awaited<ReturnType<MostroProgram["account"]["perk"]["fetch"]>>;

/** Everything read from the chain for one quote or one purchase. */
export interface PassState {
   config: ConfigAccount;
   curve: CurveAccount;
   perk: PerkAccount;
   perkAddress: PublicKey;
   artistAddress: PublicKey;
   quote: PassQuote;
}

/** Connection to Solana devnet, the Mostro program, the sponsor key, and the live pass quote. */
@Injectable()
export class SolanaService {
   private readonly logger = new Logger(SolanaService.name);
   readonly connection: Connection;
   readonly program: MostroProgram;
   private devnetChecked: Promise<void> | null = null;
   private sponsorKey: Keypair | null = null;

   constructor(@Inject(ENV) private readonly env: Env) {
      this.connection = new Connection(env.SOLANA_RPC_URL, "confirmed");
      this.program = createReadonlyProgram(this.connection);
   }

   /** The sponsor keypair, held only here on the server. Never logged, never returned. */
   sponsor(): Keypair {
      if (this.sponsorKey) return this.sponsorKey;
      const raw = this.env.SPONSOR_SECRET_KEY;
      if (!raw) throw apiError(503, "SPONSOR_UNAVAILABLE", "The sponsor wallet is not configured on the server.");
      try {
         const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
         this.sponsorKey = Keypair.fromSecretKey(bytes);
      } catch {
         throw apiError(503, "SPONSOR_UNAVAILABLE", "The sponsor wallet is misconfigured on the server.");
      }
      return this.sponsorKey;
   }

   /** Refuses to run against anything but Solana devnet with the program from the repository's devnet config. */
   ensureDevnet(): Promise<void> {
      this.devnetChecked ??= (async () => {
         if (this.program.programId.toBase58() !== devnetAddresses.programId) throw new Error("The program id in the IDL does not match shared/addresses/devnet.json.");
         const genesis = await this.connection.getGenesisHash();
         if (genesis !== DEVNET_GENESIS_HASH) throw new Error(`SOLANA_RPC_URL is not Solana devnet (genesis ${genesis}).`);
         const info = await this.connection.getAccountInfo(this.program.programId);
         if (!info?.executable) throw new Error("The Mostro program is not deployed on this cluster.");
      })().catch((err: Error) => {
         this.devnetChecked = null;
         this.logger.error(err.message);
         throw new ServiceUnavailableException("The server is not connected to Solana devnet.");
      });
      return this.devnetChecked;
   }

   /** Fresh curve, config and perk from the chain, and the live quote for exactly the pass price. */
   async loadPassState(): Promise<PassState> {
      await this.ensureDevnet();
      const artistAddress = artistPda(DEMO_PASS.artistIndex)[0];
      const perkAddress = perkPda(artistAddress, DEMO_PASS.perkIndex)[0];
      const devnetPerk = devnetAddresses.artists[DEMO_PASS.artistIndex]?.perks[DEMO_PASS.perkIndex];
      if (!devnetPerk || devnetPerk.perk !== perkAddress.toBase58()) throw new Error("The demo perk does not match shared/addresses/devnet.json.");

      const [config, curve, perk] = await Promise.all([fetchConfig(this.program), fetchCurve(this.program, DEMO_PASS.curveIndex), this.program.account.perk.fetch(perkAddress)]);

      if (perk.name !== DEMO_PASS.name || perkKindName(perk.kind) !== "pass" || perk.tier !== 0) {
         throw apiError(409, "PASS_PRICE_CHANGED", "The demo pass is not the expected perk. Contact the team.");
      }
      if (BigInt(perk.priceTokens.toString()) !== DEMO_PASS.priceBaseUnits) {
         throw apiError(409, "PASS_PRICE_CHANGED", "The pass price changed. Refresh and review the new price.");
      }

      // The SOL price is never hardcoded: it is whatever the curve charges right now for exactly the pass price.
      const q = quoteBuyExactOut(curve.virtualSolReserves, curve.virtualTokenReserves, perk.priceTokens, config.feeBps);
      const quote: PassQuote = {
         cluster: "devnet",
         pass: {
            name: perk.name,
            artistIndex: DEMO_PASS.artistIndex,
            perkIndex: DEMO_PASS.perkIndex,
            priceMost: perk.priceTokens.toString(),
            active: perk.active,
            sold: perk.sold,
            maxSupply: perk.maxSupply,
         },
         tokensOut: q.tokensOut.toString(),
         lamportsCost: q.netIn.toString(),
         lamportsFee: q.fee.toString(),
         lamportsTotal: q.totalIn.toString(),
         maxLamportsIn: maxIn(q.totalIn, DEMO_PASS.slippageBps).toString(),
         slippageBps: DEMO_PASS.slippageBps,
         usdPerSolE6: config.priceMode === 0 && !new BN(config.solUsdPriceE6).isZero() ? config.solUsdPriceE6.toString() : null,
      };
      return { config, curve, perk, perkAddress, artistAddress, quote };
   }

   /** Fresh config and curve from the chain, and the live quote for buying exactly `tokens` whole $MOST. */
   async loadTokenState(tokens: number): Promise<{ config: ConfigAccount; curve: CurveAccount; tokensOut: BN; quote: TokenQuote }> {
      await this.ensureDevnet();
      const [config, curve] = await Promise.all([fetchConfig(this.program), fetchCurve(this.program, DEMO_PASS.curveIndex)]);
      const tokensOut = new BN((BigInt(tokens) * TOKEN_BASE_UNITS).toString());
      let q: ReturnType<typeof quoteBuyExactOut>;
      try {
         q = quoteBuyExactOut(curve.virtualSolReserves, curve.virtualTokenReserves, tokensOut, config.feeBps);
      } catch {
         throw apiError(409, "QUOTE_CHANGED", "That amount is not available on the curve right now. Try a smaller amount.");
      }
      const quote: TokenQuote = {
         cluster: "devnet",
         tokens,
         tokensOut: tokensOut.toString(),
         lamportsCost: q.netIn.toString(),
         lamportsFee: q.fee.toString(),
         lamportsTotal: q.totalIn.toString(),
         maxLamportsIn: maxIn(q.totalIn, DEMO_PASS.slippageBps).toString(),
         slippageBps: DEMO_PASS.slippageBps,
         usdPerSolE6: config.priceMode === 0 && !new BN(config.solUsdPriceE6).isZero() ? config.solUsdPriceE6.toString() : null,
      };
      return { config, curve, tokensOut, quote };
   }

   /** Blacklisted wallets cannot buy or redeem (there is no on-chain KYC; everyone else is allowed). */
   async isBlacklisted(wallet: PublicKey): Promise<boolean> {
      return isBlacklisted(this.program, wallet);
   }
}
