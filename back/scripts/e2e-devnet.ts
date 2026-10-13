/**
 * Real devnet end-to-end check of the sponsored pass purchase, with a THROWAWAY buyer wallet (the Openfort signing step
 * is replaced by a local key, everything else is the production code path):
 *   quote -> build (sponsor signs) -> buyer signs -> send -> confirm -> verify the redemption.
 * It spends devnet SOL: the buyer needs about 0.04 SOL (airdrop first, sponsor transfer as fallback) and the sponsor
 * pays the fee and the rent of the pass accounts (about 0.006 SOL).
 *
 *   yarn workspace @mostro/back e2e:devnet
 */
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { loadEnv } from "../src/config/env";
import { PurchaseTransactionBuilder } from "../src/modules/solana/purchase-transaction.builder";
import { SolanaService } from "../src/modules/solana/solana.service";
import { BuildSponsoredPurchaseUseCase } from "../src/use-cases/pass/build-sponsored-purchase.use-case";
import { GetPurchaseResultUseCase } from "../src/use-cases/pass/get-purchase-result.use-case";
import type { OpenfortIdentity, OpenfortService } from "../src/modules/openfort/openfort.service";

const sol = (lamports: bigint | number) => `${Number(lamports) / LAMPORTS_PER_SOL} SOL`;
const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;

async function main() {
   const env = loadEnv();
   const solana = new SolanaService(env);
   await solana.ensureDevnet();
   const sponsor = solana.sponsor();
   const { connection } = solana;
   // The one thing replaced: Openfort's "does this wallet belong to the user" check, because the buyer is a local test key.
   const openfort = { ownsSolanaWallet: async () => true } as unknown as OpenfortService;
   const identity = { openfortId: "usr_e2e_test", loginType: "email", email: null, imageUrl: null } as OpenfortIdentity;

   const buyer = Keypair.generate();
   console.log("cluster              : devnet", `(${connection.rpcEndpoint})`);
   console.log("sponsor              :", sponsor.publicKey.toBase58(), "balance", sol(await connection.getBalance(sponsor.publicKey)));
   console.log("buyer (throwaway)    :", buyer.publicKey.toBase58());

   // 1. Live quote, shown to the user before they confirm.
   const state = await solana.loadPassState();
   console.log("live quote           :", sol(BigInt(state.quote.lamportsTotal)), `(max ${sol(BigInt(state.quote.maxLamportsIn))}) for ${Number(state.quote.tokensOut) / 1e6} $MOST`);

   // 2. Fund the buyer's SOL for the trade (the card payment in the real app).
   const rentFloor = BigInt(await connection.getMinimumBalanceForRentExemption(0));
   const needed = BigInt(state.quote.maxLamportsIn) + rentFloor;
   const fundLamports = Number(needed) + 2_000_000;
   try {
      const airdrop = await connection.requestAirdrop(buyer.publicKey, fundLamports);
      await connection.confirmTransaction(airdrop, "confirmed");
      console.log("buyer funded by      : devnet airdrop", sol(fundLamports));
   } catch {
      const fund = new Transaction().add(SystemProgram.transfer({ fromPubkey: sponsor.publicKey, toPubkey: buyer.publicKey, lamports: fundLamports }));
      await sendAndConfirmTransaction(connection, fund, [sponsor], { commitment: "confirmed" });
      console.log("buyer funded by      : sponsor transfer (airdrop unavailable)", sol(fundLamports));
   }
   const buyerBefore = BigInt(await connection.getBalance(buyer.publicKey));
   const sponsorBefore = BigInt(await connection.getBalance(sponsor.publicKey));

   // 3. Backend: build the sponsored transaction (validates, quotes again, fresh blockhash, sponsor signs).
   const build = new BuildSponsoredPurchaseUseCase(env, openfort, solana, new PurchaseTransactionBuilder(solana));
   const built = await build.execute(identity, { walletAddress: buyer.publicKey.toBase58(), approvedMaxLamportsIn: state.quote.maxLamportsIn });
   const raw = Buffer.from(built.transaction, "base64");
   console.log("transaction size     :", raw.length, "bytes (limit 1232)");

   // 4. Frontend: the buyer signs (Openfort in the app, a local key here), then the signed transaction is submitted.
   const tx = Transaction.from(raw);
   tx.partialSign(buyer);
   const signature = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
   console.log("submitted            :", explorer(signature));
   const confirmation = await connection.confirmTransaction({ signature, blockhash: built.blockhash, lastValidBlockHeight: built.lastValidBlockHeight }, "confirmed");
   if (confirmation.value.err) throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);

   // 5. Backend verification: success only from the chain.
   const result = await new GetPurchaseResultUseCase(openfort, solana).execute(identity, { walletAddress: buyer.publicKey.toBase58(), signature });
   console.log("verified result      :", JSON.stringify(result));
   if (result.status !== "confirmed") throw new Error("The purchase was not confirmed.");

   const parsed = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
   const buyerAfter = BigInt(await connection.getBalance(buyer.publicKey));
   const sponsorAfter = BigInt(await connection.getBalance(sponsor.publicKey));
   console.log("compute units used   :", parsed?.meta?.computeUnitsConsumed);
   console.log("buyer SOL spent      :", sol(buyerBefore - buyerAfter), "(only the trade; quote was", sol(BigInt(state.quote.lamportsTotal)) + ")");
   console.log("sponsor SOL spent    :", sol(sponsorBefore - sponsorAfter), "(fee + rent of the pass accounts)");
   console.log("pass asset           :", `https://explorer.solana.com/address/${result.asset}?cluster=devnet`);
   console.log("pass number          :", result.edition);
   console.log("DONE: purchase and redemption confirmed on devnet in one transaction.");
}

main().catch((err) => {
   console.error("E2E FAILED:", err?.message ?? err);
   process.exit(1);
});
