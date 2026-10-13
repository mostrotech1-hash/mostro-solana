/**
 * Real devnet check of the simulated card step (POST /pass/devnet-topup) with a THROWAWAY wallet: the sponsor sends the
 * MoonPay minimum, then the whole amount is sent back to the sponsor. Spends only network fees.
 *
 *   yarn workspace @mostro/back tsx scripts/check-topup.ts
 */
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadEnv } from "../src/config/env";
import { SolanaService } from "../src/modules/solana/solana.service";
import { TopupDevnetUseCase } from "../src/use-cases/pass/topup-devnet.use-case";
import type { OpenfortIdentity, OpenfortService } from "../src/modules/openfort/openfort.service";

async function main() {
   const env = loadEnv();
   const solana = new SolanaService(env);
   await solana.ensureDevnet();
   const sponsor = solana.sponsor();
   const { connection } = solana;
   const openfort = { ownsSolanaWallet: async () => true } as unknown as OpenfortService;
   const identity = { openfortId: "usr_topup_check", loginType: "email", email: null, imageUrl: null } as OpenfortIdentity;

   const buyer = Keypair.generate();
   const sponsorBefore = await connection.getBalance(sponsor.publicKey);
   const result = await new TopupDevnetUseCase(env, openfort, solana).execute(identity, { walletAddress: buyer.publicKey.toBase58() });
   console.log("top-up result    :", JSON.stringify(result));
   const buyerBalance = await connection.getBalance(buyer.publicKey, "confirmed");
   console.log("buyer balance    :", buyerBalance / LAMPORTS_PER_SOL, "SOL (expected", env.DEVNET_TOPUP_LAMPORTS / LAMPORTS_PER_SOL + ")");
   if (buyerBalance !== env.DEVNET_TOPUP_LAMPORTS) throw new Error("The top-up amount is not the configured one.");

   // Second call: the wallet is no longer short, so nothing is sent.
   const again = await new TopupDevnetUseCase(env, openfort, solana).execute({ ...identity, openfortId: "usr_topup_check_2" }, { walletAddress: buyer.publicKey.toBase58() });
   console.log("second call      :", JSON.stringify(again));
   if (again.signature !== null) throw new Error("A wallet that is not short must not be topped up again.");

   // Send everything back to the sponsor (minus the fee).
   const back = new Transaction().add(SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: sponsor.publicKey, lamports: buyerBalance - 5_000 }));
   await sendAndConfirmTransaction(connection, back, [buyer], { commitment: "confirmed" });
   console.log("sponsor change   :", (((await connection.getBalance(sponsor.publicKey)) - sponsorBefore) / LAMPORTS_PER_SOL).toFixed(6), "SOL (fees only)");
   console.log("OK: the simulated card top-up works on devnet.");
}

main().catch((err) => {
   console.error("CHECK FAILED:", err?.message ?? err);
   process.exit(1);
});
