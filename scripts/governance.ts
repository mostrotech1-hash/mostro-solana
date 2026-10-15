/**
 * Governance CLI for the weighted multisig. The CLI wallet must be a member for every write.
 *
 *   npx ts-node scripts/governance.ts members
 *   npx ts-node scripts/governance.ts proposals [open]
 *   npx ts-node scripts/governance.ts propose-member <wallet> <role: 0|1|2>
 *   npx ts-node scripts/governance.ts propose-transfer <vault> <destination> <amount> [curveIndex=0]
 *   npx ts-node scripts/governance.ts approve <proposalIndex>
 *   npx ts-node scripts/governance.ts execute <proposalIndex>
 *   npx ts-node scripts/governance.ts cancel <proposalIndex>
 *   npx ts-node scripts/governance.ts pause                       # emergency: stops buys and redeems
 *
 * Vaults: artist_reserve | mostro_reserve | dex_reserve | rewards | usdc (curve vaults, need a curve index),
 *         treasury_usdc | treasury_sol (no curve), sol (the curve's SOL vault). Amounts are whole units
 *         (tokens, USDC or SOL) and converted to base units. `destination` is a token account for token
 *         vaults and a wallet for SOL vaults.
 *
 * A proposal executes when the approvals weigh strictly more than 51 % of the total weight (admins 1,
 * super-admins 2). The proposer's approval is recorded at creation.
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
   PROPOSAL_SET_MEMBER,
   PROPOSAL_VAULT_TRANSFER,
   ROLE_NONE,
   TOKEN_DECIMALS,
   USDC_DECIMALS,
   USDC_MINT_DEVNET,
   VAULT_NAMES,
   VaultName,
   approvalPda,
   artistReservePda,
   computeBudgetIxs,
   configPda,
   curvePda,
   curveUsdcAta,
   dexReservePda,
   explorerTx,
   isCurveVault,
   isSolVault,
   log,
   memberPda,
   mintPda,
   mostroReservePda,
   proposalPda,
   rewardsVaultPda,
   run,
   section,
   setup,
   solVaultPda,
   toBaseUnits,
   treasuryPda,
   treasuryUsdcAta,
   vaultKind,
} from "./common";

function usage(): never {
   console.error(
      "usage: governance.ts members | proposals [open] | propose-member <wallet> <role> | propose-transfer <vault> <destination> <amount> [curveIndex] | approve <i> | execute <i> | cancel <i> | pause",
   );
   process.exit(2);
}

const roleName = (r: number) => ["none", "admin (1)", "super-admin (2)"][r] ?? `unknown (${r})`;

run(async () => {
   const [cmd, ...rest] = process.argv.slice(2);
   if (!cmd) usage();
   const ctx = setup();
   const me = ctx.wallet.publicKey;
   const config = await ctx.program.account.config.fetch(configPda());
   const memberAccounts = { memberWallet: me, config: configPda(), member: memberPda(me) };
   const now = Math.floor(Date.now() / 1000);
   const needed = Math.floor((config.totalWeight * 51) / 100) + 1;

   switch (cmd) {
      case "members": {
         section(`Members (total weight ${config.totalWeight}, ${needed} needed to pass)`);
         const members = (await ctx.program.account.member.all()).filter((m) => m.account.role !== ROLE_NONE);
         for (const m of members) log(m.account.wallet.toBase58(), roleName(m.account.role));
         return;
      }
      case "proposals": {
         const openOnly = rest[0] === "open";
         section(`Proposals${openOnly ? " (open)" : ""}`);
         const all = (await ctx.program.account.proposal.all()).sort((a, b) => a.account.index.cmp(b.account.index));
         for (const { account: p } of all) {
            const status = p.executed ? "executed" : p.cancelled ? "cancelled" : now > p.expiresTs.toNumber() ? "expired" : "open";
            if (openOnly && status !== "open") continue;
            const what =
               p.kind === PROPOSAL_SET_MEMBER
                  ? `set member ${p.wallet.toBase58()} -> ${roleName(p.role)}`
                  : `transfer ${p.amount.toString()} from ${VAULT_NAMES[p.vault]}${isCurveVault(p.vault) ? ` of curve ${p.curve.toBase58()}` : ""} to ${p.destination.toBase58()}`;
            log(
               `#${p.index.toString()} [${status}]`,
               `${what}; approved ${p.approvedWeight}/${config.totalWeight}, expires ${new Date(p.expiresTs.toNumber() * 1000).toISOString()}`,
            );
         }
         return;
      }
      case "pause": {
         const sig = await ctx.program.methods.emergencyPause().accountsStrict(memberAccounts).preInstructions(computeBudgetIxs(50_000)).rpc();
         log("emergency_pause", explorerTx(sig, ctx.cluster));
         log("resume with", "scripts/set-config.ts buysPaused=false redeemsPaused=false (admin)");
         return;
      }
      case "propose-member":
      case "propose-transfer": {
         let args;
         if (cmd === "propose-member") {
            const [walletArg, roleArg] = rest;
            if (!walletArg || roleArg === undefined) usage();
            args = {
               kind: PROPOSAL_SET_MEMBER,
               curve: PublicKey.default,
               vault: 0,
               destination: PublicKey.default,
               amount: new BN(0),
               wallet: new PublicKey(walletArg),
               role: Number(roleArg),
            };
         } else {
            const [vaultArg, destArg, amountArg, curveArg = "0"] = rest;
            if (!VAULT_NAMES.includes(vaultArg as VaultName) || !destArg || !amountArg) usage();
            const vault = vaultKind(vaultArg as VaultName);
            const decimals = isSolVault(vault) ? 9 : vault === vaultKind("usdc") || vault === vaultKind("treasury_usdc") ? USDC_DECIMALS : TOKEN_DECIMALS;
            args = {
               kind: PROPOSAL_VAULT_TRANSFER,
               curve: isCurveVault(vault) ? curvePda(Number(curveArg)) : PublicKey.default,
               vault,
               destination: new PublicKey(destArg),
               amount: new BN(toBaseUnits(amountArg, decimals).toString()),
               wallet: PublicKey.default,
               role: 0,
            };
         }
         const proposal = proposalPda(config.proposalCount);
         const sig = await ctx.program.methods
            .createProposal(args)
            .accountsStrict({ proposer: me, config: configPda(), member: memberPda(me), proposal, approval: approvalPda(proposal, me), systemProgram: SystemProgram.programId })
            .preInstructions(computeBudgetIxs(80_000))
            .rpc();
         log("create_proposal", explorerTx(sig, ctx.cluster));
         log("proposal", `#${config.proposalCount.toString()} ${proposal.toBase58()}`);
         const p = await ctx.program.account.proposal.fetch(proposal);
         log("approved weight", `${p.approvedWeight}/${config.totalWeight} (${needed} needed)`);
         return;
      }
      case "approve":
      case "execute":
      case "cancel": {
         const index = Number(rest[0]);
         if (!Number.isInteger(index)) usage();
         const proposal = proposalPda(index);
         const p = await ctx.program.account.proposal.fetch(proposal);
         if (cmd === "approve") {
            const sig = await ctx.program.methods
               .approveProposal()
               .accountsStrict({ ...memberAccounts, proposal, approval: approvalPda(proposal, me), systemProgram: SystemProgram.programId })
               .preInstructions(computeBudgetIxs(80_000))
               .rpc();
            log("approve_proposal", explorerTx(sig, ctx.cluster));
            const after = await ctx.program.account.proposal.fetch(proposal);
            log("approved weight", `${after.approvedWeight}/${config.totalWeight} (${needed} needed)`);
            return;
         }
         if (cmd === "cancel") {
            const sig = await ctx.program.methods
               .cancelProposal()
               .accountsStrict({ memberWallet: me, member: memberPda(me), proposal })
               .preInstructions(computeBudgetIxs(50_000))
               .rpc();
            log("cancel_proposal", explorerTx(sig, ctx.cluster));
            return;
         }
         // execute
         if (p.kind === PROPOSAL_SET_MEMBER) {
            const sig = await ctx.program.methods
               .executeSetMember()
               .accountsStrict({ ...memberAccounts, proposal, target: memberPda(p.wallet), systemProgram: SystemProgram.programId })
               .preInstructions(computeBudgetIxs(80_000))
               .rpc();
            log("execute_set_member", explorerTx(sig, ctx.cluster));
            const c = await ctx.program.account.config.fetch(configPda());
            log("total weight", `${c.totalWeight} (${c.memberCount} members)`);
            return;
         }
         const curveKey = isCurveVault(p.vault) ? p.curve : null;
         if (isSolVault(p.vault)) {
            const source = p.vault === vaultKind("sol") ? solVaultPda(p.curve) : treasuryPda();
            const sig = await ctx.program.methods
               .executeSolTransfer()
               .accountsStrict({ ...memberAccounts, proposal, curve: curveKey, source, destination: p.destination, systemProgram: SystemProgram.programId })
               .preInstructions(computeBudgetIxs(80_000))
               .rpc();
            log("execute_sol_transfer", explorerTx(sig, ctx.cluster));
            return;
         }
         let source: PublicKey;
         let mint: PublicKey;
         const curveIndex = curveKey ? (await ctx.program.account.curve.fetch(curveKey)).index : 0;
         switch (VAULT_NAMES[p.vault]) {
            case "artist_reserve":
               source = artistReservePda(p.curve);
               mint = mintPda(curveIndex);
               break;
            case "mostro_reserve":
               source = mostroReservePda(p.curve);
               mint = mintPda(curveIndex);
               break;
            case "dex_reserve":
               source = dexReservePda(p.curve);
               mint = mintPda(curveIndex);
               break;
            case "rewards":
               source = rewardsVaultPda(p.curve);
               mint = mintPda(curveIndex);
               break;
            case "usdc":
               source = curveUsdcAta(p.curve, USDC_MINT_DEVNET);
               mint = USDC_MINT_DEVNET;
               break;
            case "treasury_usdc":
               source = treasuryUsdcAta(USDC_MINT_DEVNET);
               mint = USDC_MINT_DEVNET;
               break;
            default:
               throw new Error(`unknown vault ${p.vault}`);
         }
         const sig = await ctx.program.methods
            .executeTokenTransfer()
            .accountsStrict({ ...memberAccounts, proposal, curve: curveKey, mint, source, destination: p.destination, tokenProgram: TOKEN_PROGRAM_ID })
            .preInstructions(computeBudgetIxs(80_000))
            .rpc();
         log("execute_token_transfer", explorerTx(sig, ctx.cluster));
         return;
      }
      default:
         usage();
   }
});
