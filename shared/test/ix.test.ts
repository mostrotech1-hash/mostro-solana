import { expect } from "chai";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { createReadonlyProgram } from "../src/program";
import idlJson from "../idl/mostro.json";
import {
   buildBuyTokensSol,
   buildBuyTokensExactOutSol,
   buildBuyTokensUsdc,
   buildRedeemPerk,
   buildBuyPerkSol,
   buildCreatePerk,
   buildSetPerk,
   buildFulfillReceipt,
   buildCreateCurve,
   buildSetBlacklist,
   buildCreateProposal,
   buildApproveProposal,
   buildCancelProposal,
   buildExecuteVaultTransfer,
   buildExecuteSetMember,
   buildEmergencyPause,
   prepareRedeemPerk,
   prepareBuyPerkSol,
   randomNonce,
} from "../src/ix";
import {
   approvalPda,
   artistPda,
   artistReservePda,
   assetPda,
   ata,
   blacklistPda,
   collectionPda,
   configPda,
   curvePda,
   curveUsdcVaultAta,
   curveVaultPda,
   memberPda,
   metadataPda,
   mintPda,
   mostroReservePda,
   perkPda,
   proposalPda,
   receiptPda,
   rewardsVaultPda,
   solVaultPda,
   spendPda,
   treasuryPda,
   treasuryUsdcAta,
} from "../src/pda";
import {
   DEFAULT_COLLECTION_SALT,
   DEVNET_USDC_MINT,
   MPL_CORE_PROGRAM_ID,
   PROGRAM_ID,
   PYTH_SOL_USD_ACCOUNT,
   ROLE_ADMIN,
   TOKEN_METADATA_PROGRAM_ID,
   VaultKind,
   DEMO_CURVE_PARAMS,
} from "../src/constants";
import { perkKindArg, OFFSETS, canCreatePerk, canSetPerk, canSetArtist } from "../src/accounts";

// No RPC calls are made: every account is supplied explicitly, so `.instruction()` only encodes.
const connection = new Connection("http://127.0.0.1:8899");
const program = createReadonlyProgram(connection);
const buyer = Keypair.generate().publicKey;

// The JSON IDL on disk keeps Rust snake_case names; Anchor's TS layer camelCases them.
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const camel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
function ixAccounts(name: string): string[] {
   const ix = idlJson.instructions.find((i) => i.name === snake(name));
   if (!ix) throw new Error(`no ix ${name}`);
   return ix.accounts.map((a) => camel(a.name));
}
function typeFields(name: string): string[] {
   const t = idlJson.types.find((x) => x.name === name) as { type: { kind: string; fields?: { name: string }[] } } | undefined;
   if (!t || !t.type.fields) throw new Error(`no struct type ${name}`);
   return t.type.fields.map((f) => camel(f.name));
}
function accountFields(name: string): string[] {
   const t = idlJson.types.find((x) => x.name === name) as { type: { kind: string; fields?: { name: string }[] } } | undefined;
   if (!t || !t.type.fields) throw new Error(`no account type ${name}`);
   return t.type.fields.map((f) => camel(f.name));
}

describe("IDL shape", () => {
   it("has no sell, no KYC, no single-key vault withdrawals", () => {
      const names = idlJson.instructions.map((i) => i.name);
      for (const gone of ["sell_tokens", "set_kyc", "withdraw_treasury_sol", "withdraw_treasury_usdc", "withdraw_artist_vault", "set_curve_metadata"]) {
         expect(names, gone).to.not.include(gone);
      }
      for (const present of [
         "buy_perk_sol",
         "create_proposal",
         "approve_proposal",
         "execute_token_transfer",
         "execute_sol_transfer",
         "execute_set_member",
         "emergency_pause",
         "set_blacklist",
      ]) {
         expect(names, present).to.include(present);
      }
   });

   it("memcmp offsets match the account layouts", () => {
      // disc(8) + bump(1) + version(1) = 10 before `buyer` in Receipt
      expect(accountFields("Receipt").slice(0, 6)).to.deep.equal(["bump", "version", "buyer", "perk", "artist", "asset"]);
      expect(OFFSETS.receipt).to.deep.equal({ buyer: 10, perk: 42, artist: 74, asset: 106 });
      expect(accountFields("Perk").slice(0, 6)).to.deep.equal(["bump", "version", "index", "artist", "mint", "collection"]);
      expect(OFFSETS.perk).to.deep.equal({ index: 10, artist: 14, mint: 46, collection: 78 });
      expect(accountFields("Artist").slice(0, 5)).to.deep.equal(["bump", "version", "index", "authority", "curve"]);
      expect(OFFSETS.artist).to.deep.equal({ index: 10, authority: 14, curve: 46 });
      expect(accountFields("Curve").slice(0, 5)).to.deep.equal(["bump", "version", "index", "artist", "mint"]);
      expect(OFFSETS.curve).to.deep.equal({ index: 10, artist: 14, mint: 46 });
      expect(accountFields("Proposal").slice(0, 4)).to.deep.equal(["bump", "index", "proposer", "kind"]);
      expect(OFFSETS.proposal).to.deep.equal({ index: 9, proposer: 17, kind: 49 });
      expect(accountFields("Approval").slice(0, 3)).to.deep.equal(["bump", "proposal", "member"]);
      expect(accountFields("Member").slice(0, 3)).to.deep.equal(["bump", "wallet", "role"]);
   });
});

describe("ix.ts resolves every account in IDL order", () => {
   it("buy_tokens_sol", async () => {
      const { instruction, derived } = await buildBuyTokensSol(program, { buyer, curveIndex: 0, lamportsIn: 100_000_000, minTokensOut: 1 });
      expect(instruction.programId.equals(PROGRAM_ID)).to.equal(true);
      expect(instruction.keys.length).to.equal(ixAccounts("buyTokensSol").length);
      const [curve] = curvePda(0);
      const [mint] = mintPda(0);
      const expected = [
         buyer /* payer defaults to the buyer */,
         buyer,
         configPda()[0],
         curve,
         mint,
         curveVaultPda(curve)[0],
         solVaultPda(curve)[0],
         treasuryPda()[0],
         ata(buyer, mint),
         spendPda(curve, buyer)[0],
         blacklistPda(buyer)[0],
         TOKEN_PROGRAM_ID,
         ASSOCIATED_TOKEN_PROGRAM_ID,
         SystemProgram.programId,
      ];
      instruction.keys.forEach((k, i) => expect(k.pubkey.toBase58(), `account ${i}`).to.equal(expected[i].toBase58()));
      expect(ixAccounts("buyTokensSol").slice(0, 2)).to.deep.equal(["payer", "buyer"]);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(instruction.keys[1].isSigner).to.equal(true);
      expect(instruction.keys[3].isWritable).to.equal(true);
      expect(instruction.keys[ixAccounts("buyTokensSol").indexOf("blacklistEntry")].isWritable).to.equal(false);
      expect(derived.payer.equals(buyer)).to.equal(true);
      // args: disc(8) + u64 + u64
      expect(instruction.data.length).to.equal(24);
      expect(new BN(instruction.data.subarray(8, 16), "le").toNumber()).to.equal(100_000_000);
   });

   it("a sponsor payer is encoded as a separate signer before the buyer", async () => {
      const sponsor = Keypair.generate().publicKey;
      const { instruction, derived } = await buildBuyTokensSol(program, { buyer, payer: sponsor, curveIndex: 0, lamportsIn: 2, minTokensOut: 0 });
      expect(derived.payer.equals(sponsor)).to.equal(true);
      expect(instruction.keys[0].pubkey.equals(sponsor)).to.equal(true);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(instruction.keys[0].isWritable).to.equal(true);
      expect(instruction.keys[1].pubkey.equals(buyer)).to.equal(true);
      expect(instruction.keys[1].isSigner).to.equal(true);
      // the ATA and the spend tracker are still the buyer's, not the sponsor's
      const names = ixAccounts("buyTokensSol");
      expect(instruction.keys[names.indexOf("buyerAta")].pubkey.equals(ata(buyer, mintPda(0)[0]))).to.equal(true);
      expect(instruction.keys[names.indexOf("spend")].pubkey.equals(spendPda(curvePda(0)[0], buyer)[0])).to.equal(true);
   });

   it("buy_tokens_exact_out_sol", async () => {
      const { instruction } = await buildBuyTokensExactOutSol(program, { buyer, curveIndex: 0, tokensOut: 1_000_000, maxLamportsIn: 50_000_000 });
      expect(instruction.keys.length).to.equal(ixAccounts("buyTokensExactOutSol").length);
      expect(instruction.keys[0].pubkey.equals(buyer)).to.equal(true);
      expect(instruction.keys[1].pubkey.equals(buyer)).to.equal(true);
      expect(new BN(instruction.data.subarray(16, 24), "le").toNumber()).to.equal(50_000_000);
   });

   it("buy_tokens_usdc", async () => {
      const { instruction, derived } = await buildBuyTokensUsdc(program, { buyer, curveIndex: 0, usdcIn: 5_000_000, minTokensOut: 1, usdcMint: DEVNET_USDC_MINT });
      const names = ixAccounts("buyTokensUsdc");
      expect(instruction.keys.length).to.equal(names.length);
      expect(names.slice(0, 2)).to.deep.equal(["payer", "buyer"]);
      const [curve] = curvePda(0);
      expect(derived.usdcVault.equals(curveUsdcVaultAta(curve, DEVNET_USDC_MINT))).to.equal(true);
      expect(derived.treasuryUsdc.equals(treasuryUsdcAta(DEVNET_USDC_MINT))).to.equal(true);
      expect(derived.buyerUsdc.equals(ata(buyer, DEVNET_USDC_MINT))).to.equal(true);
      expect(instruction.keys[names.indexOf("priceUpdate")].pubkey.equals(PYTH_SOL_USD_ACCOUNT)).to.equal(true);
      expect(instruction.keys[names.indexOf("blacklistEntry")].pubkey.equals(blacklistPda(buyer)[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("curveVault")].pubkey.equals(curveVaultPda(curve)[0])).to.equal(true);
   });

   it("redeem_perk derives asset/receipt from the nonce and passes the blacklist entry", async () => {
      const nonce = new BN("42");
      const { instruction, derived } = await buildRedeemPerk(program, { buyer, artistIndex: 0, perkIndex: 1, curveIndex: 0, nonce, maxPaid: 50_000_000 });
      const names = ixAccounts("redeemPerk");
      expect(instruction.keys.length).to.equal(names.length);
      expect(names.slice(0, 2)).to.deep.equal(["payer", "buyer"]);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(instruction.keys[1].isSigner).to.equal(true);
      const artist = artistPda(0)[0];
      const perk = perkPda(artist, 1)[0];
      const curve = curvePda(0)[0];
      const mint = mintPda(0)[0];
      expect(derived.perk.equals(perk)).to.equal(true);
      expect(derived.collection.equals(collectionPda(perk, DEFAULT_COLLECTION_SALT)[0])).to.equal(true);
      expect(derived.rewardsVault.equals(rewardsVaultPda(curve)[0])).to.equal(true);
      expect(derived.asset.equals(assetPda(perk, nonce)[0])).to.equal(true);
      expect(derived.receipt.equals(receiptPda(derived.asset)[0])).to.equal(true);
      expect(derived.buyerAta.equals(ata(buyer, mint))).to.equal(true);
      expect(instruction.keys[names.indexOf("blacklistEntry")].pubkey.equals(blacklistPda(buyer)[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("mplCoreProgram")].pubkey.equals(MPL_CORE_PROGRAM_ID)).to.equal(true);
      expect(instruction.keys[names.indexOf("asset")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("receipt")].isWritable).to.equal(true);
      expect(names).to.not.include("passAsset");
      expect(names).to.not.include("artistVault");
      // args: disc(8) + nonce u64 + max_paid u64
      expect(instruction.data.length).to.equal(24);
      expect(new BN(instruction.data.subarray(8, 16), "le").toString()).to.equal("42");
      expect(new BN(instruction.data.subarray(16, 24), "le").toNumber()).to.equal(50_000_000);
   });

   it("prepareRedeemPerk encodes perk.priceTokens as max_paid and uses perk.collection", async () => {
      const artist = artistPda(0)[0];
      const perkKey = perkPda(artist, 2)[0];
      const collection = Keypair.generate().publicKey;
      const r = await prepareRedeemPerk(program, perkKey, { priceTokens: new BN(1_000_000), artist, collection }, { buyer, curveIndex: 0 });
      expect(r.paid.toNumber()).to.equal(1_000_000);
      expect(new BN(r.instruction.data.subarray(16, 24), "le").toNumber()).to.equal(1_000_000);
      expect(r.derived.collection.equals(collection)).to.equal(true);
   });

   it("buy_perk_sol wires both vaults, the artist wallet and the SOL accounts", async () => {
      const artistAuthority = Keypair.generate().publicKey;
      const { instruction, derived } = await buildBuyPerkSol(program, { buyer, artistIndex: 0, perkIndex: 5, curveIndex: 0, artistAuthority, maxLamports: 200_000_000, nonce: 9 });
      const names = ixAccounts("buyPerkSol");
      expect(instruction.keys.length).to.equal(names.length);
      const curve = curvePda(0)[0];
      expect(instruction.keys[names.indexOf("artistAuthority")].pubkey.equals(artistAuthority)).to.equal(true);
      expect(instruction.keys[names.indexOf("artistAuthority")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("curveVault")].pubkey.equals(curveVaultPda(curve)[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("artistReserve")].pubkey.equals(artistReservePda(curve)[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("solVault")].pubkey.equals(solVaultPda(curve)[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("treasury")].pubkey.equals(treasuryPda()[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("spend")].pubkey.equals(spendPda(curve, buyer)[0])).to.equal(true);
      expect(derived.asset.equals(assetPda(derived.perk, 9)[0])).to.equal(true);
      expect(names).to.not.include("buyerAta"); // the buyer never holds the tokens
      expect(new BN(instruction.data.subarray(16, 24), "le").toNumber()).to.equal(200_000_000);

      const curveState = {
         virtualSolReserves: DEMO_CURVE_PARAMS.virtualSolReserves,
         virtualTokenReserves: DEMO_CURVE_PARAMS.virtualTokenReserves,
         supplyCap: DEMO_CURVE_PARAMS.supplyCap,
         tokensSold: 0,
      };
      const prepared = await prepareBuyPerkSol(
         program,
         curveState,
         100,
         derived.perk,
         { priceLamports: new BN(200_000_000), artist: derived.artist, collection: derived.collection },
         artistAuthority,
         { buyer, curveIndex: 0 },
      );
      expect(prepared.quote.curveHalf.toNumber()).to.equal(100_000_000);
      expect(prepared.derived.maxLamports.toNumber()).to.equal(200_000_000);
   });

   it("collection PDA is salted; a non-default salt changes the address", async () => {
      const perk = perkPda(artistPda(0)[0], 2)[0];
      const c1 = collectionPda(perk, 1)[0];
      const c2 = collectionPda(perk, 2)[0];
      expect(c1.equals(c2)).to.equal(false);
      expect(collectionPda(perk)[0].equals(c1)).to.equal(true);
      const { derived } = await buildRedeemPerk(program, { buyer, artistIndex: 0, perkIndex: 2, curveIndex: 0, maxPaid: 1, collectionSalt: 2 });
      expect(derived.collection.equals(c2)).to.equal(true);
   });

   it("random nonces are u64 and distinct", () => {
      const a = randomNonce();
      const b = randomNonce();
      expect(a.bitLength()).to.be.lte(64);
      expect(a.eq(b)).to.equal(false);
   });

   it("create_perk encodes the enum arg, both prices and the collection salt", async () => {
      expect(typeFields("CreatePerkArgs")).to.deep.equal(["kind", "tier", "priceTokens", "priceLamports", "maxSupply", "publicStartTs", "name", "uri", "collectionSalt"]);
      const { instruction, derived } = await buildCreatePerk(program, {
         signer: buyer,
         artistIndex: 0,
         perkIndex: 0,
         curveIndex: 0,
         args: {
            kind: perkKindArg("pass"),
            tier: 1,
            priceTokens: 300_000_000_000,
            priceLamports: 0,
            maxSupply: 0,
            publicStartTs: 0,
            name: "Mostro Pass VIP",
            uri: "https://example.com/vip.json",
            collectionSalt: 7,
         },
      });
      expect(instruction.keys.length).to.equal(ixAccounts("createPerk").length);
      expect(ixAccounts("createPerk")).to.not.include("artistVault");
      expect(derived.collection.equals(collectionPda(derived.perk, 7)[0])).to.equal(true);
      const decoded = new BorshInstructionCoder(program.idl).decode(instruction.data) as {
         name: string;
         data: { args: { kind: Record<string, unknown>; tier: number; priceTokens: BN; priceLamports: BN; collectionSalt: BN } };
      } | null;
      if (!decoded) throw new Error("decode failed");
      expect(decoded.name).to.equal("createPerk");
      expect(Object.keys(decoded.data.args.kind)[0].toLowerCase()).to.equal("pass");
      expect(decoded.data.args.priceTokens.toString()).to.equal("300000000000");
      expect(decoded.data.args.priceLamports.toNumber()).to.equal(0);
      expect(decoded.data.args.collectionSalt.toNumber()).to.equal(7);
      const set = await buildSetPerk(program, { signer: buyer, artistIndex: 0, perkIndex: 0, args: { priceLamports: 5 } });
      expect(set.instruction.keys.length).to.equal(ixAccounts("setPerk").length);
      const ful = await buildFulfillReceipt(program, { signer: buyer, artistIndex: 0, receipt: derived.perk, by: "asset" });
      expect(ful.derived.receipt.equals(receiptPda(derived.perk)[0])).to.equal(true);
   });

   it("create_curve lists the four vaults, the metadata PDA and the rent sysvar", async () => {
      const { instruction, derived } = await buildCreateCurve(program, {
         admin: buyer,
         curveIndex: 0,
         artistIndex: 0,
         usdcMint: DEVNET_USDC_MINT,
         args: {
            name: "T",
            symbol: "T",
            uri: "u",
            virtualSolReserves: DEMO_CURVE_PARAMS.virtualSolReserves,
            virtualTokenReserves: DEMO_CURVE_PARAMS.virtualTokenReserves,
            saleStartTs: 0,
         },
      });
      const names = ixAccounts("createCurve");
      expect(instruction.keys.length).to.equal(names.length);
      for (const n of ["curveVault", "artistReserve", "mostroReserve", "dexReserve", "rewardsVault", "solVault", "usdcVault", "metadata"]) expect(names).to.include(n);
      expect(derived.metadata.equals(metadataPda(mintPda(0)[0])[0])).to.equal(true);
      expect(instruction.keys[names.indexOf("tokenMetadataProgram")].pubkey.equals(TOKEN_METADATA_PROGRAM_ID)).to.equal(true);
      expect(typeFields("CreateCurveArgs")).to.not.include("supplyCap");
   });

   it("set_blacklist and emergency_pause", async () => {
      const wallet = Keypair.generate().publicKey;
      const b = await buildSetBlacklist(program, { admin: buyer, wallet, blocked: true });
      expect(b.derived.entry.equals(blacklistPda(wallet)[0])).to.equal(true);
      expect(b.instruction.data[b.instruction.data.length - 1]).to.equal(1);
      const e = await buildEmergencyPause(program, buyer);
      expect(e.derived.member.equals(memberPda(buyer)[0])).to.equal(true);
      expect(e.instruction.keys.length).to.equal(ixAccounts("emergencyPause").length);
   });

   it("governance builders", async () => {
      const curve = curvePda(0)[0];
      const dest = Keypair.generate().publicKey;
      const p = await buildCreateProposal(program, {
         proposer: buyer,
         proposalIndex: 4,
         args: { kind: "vaultTransfer", vault: VaultKind.ArtistReserve, curve, destination: dest, amount: 1_000 },
      });
      expect(p.derived.proposal.equals(proposalPda(4)[0])).to.equal(true);
      expect(p.derived.approval.equals(approvalPda(p.derived.proposal, buyer)[0])).to.equal(true);
      const decoded = new BorshInstructionCoder(program.idl).decode(p.instruction.data) as {
         data: { args: { kind: number; vault: number; curve: PublicKey; wallet: PublicKey; role: number } };
      } | null;
      if (!decoded) throw new Error("decode failed");
      expect(decoded.data.args.kind).to.equal(0);
      expect(decoded.data.args.vault).to.equal(VaultKind.ArtistReserve);
      expect(decoded.data.args.curve.equals(curve)).to.equal(true);
      // treasury vaults never carry a curve
      const t = await buildCreateProposal(program, {
         proposer: buyer,
         proposalIndex: 5,
         args: { kind: "vaultTransfer", vault: VaultKind.TreasurySol, curve, destination: dest, amount: 1 },
      });
      const tDecoded = new BorshInstructionCoder(program.idl).decode(t.instruction.data) as { data: { args: { curve: PublicKey } } } | null;
      expect(tDecoded?.data.args.curve.equals(PublicKey.default)).to.equal(true);
      const m = await buildCreateProposal(program, { proposer: buyer, proposalIndex: 6, args: { kind: "setMember", wallet: dest, role: ROLE_ADMIN } });
      const mDecoded = new BorshInstructionCoder(program.idl).decode(m.instruction.data) as { data: { args: { kind: number; wallet: PublicKey; role: number } } } | null;
      expect(mDecoded?.data.args.kind).to.equal(1);
      expect(mDecoded?.data.args.role).to.equal(ROLE_ADMIN);

      const a = await buildApproveProposal(program, { member: buyer, proposal: p.derived.proposal });
      expect(a.instruction.keys.length).to.equal(ixAccounts("approveProposal").length);
      const c = await buildCancelProposal(program, { member: buyer, proposal: p.derived.proposal });
      expect(c.instruction.keys.length).to.equal(ixAccounts("cancelProposal").length);

      // execute: token vault -> execute_token_transfer with the derived source
      const tok = await buildExecuteVaultTransfer(program, {
         member: buyer,
         proposal: p.derived.proposal,
         proposalAccount: { vault: VaultKind.MostroReserve, curve, destination: dest },
         curveIndex: 0,
      });
      const tokNames = ixAccounts("executeTokenTransfer");
      expect(tok.instruction.keys.length).to.equal(tokNames.length);
      expect(tok.derived.source.equals(mostroReservePda(curve)[0])).to.equal(true);
      expect(tok.instruction.keys[tokNames.indexOf("mint")].pubkey.equals(mintPda(0)[0])).to.equal(true);
      // SOL vault -> execute_sol_transfer; treasury -> curve encoded as None (program id)
      const sol = await buildExecuteVaultTransfer(program, {
         member: buyer,
         proposal: p.derived.proposal,
         proposalAccount: { vault: VaultKind.TreasurySol, curve: PublicKey.default, destination: dest },
      });
      const solNames = ixAccounts("executeSolTransfer");
      expect(sol.instruction.keys.length).to.equal(solNames.length);
      expect(sol.derived.source.equals(treasuryPda()[0])).to.equal(true);
      expect(sol.instruction.keys[solNames.indexOf("curve")].pubkey.equals(PROGRAM_ID)).to.equal(true);
      const usdc = await buildExecuteVaultTransfer(program, {
         member: buyer,
         proposal: p.derived.proposal,
         proposalAccount: { vault: VaultKind.TreasuryUsdc, curve: PublicKey.default, destination: dest },
         usdcMint: DEVNET_USDC_MINT,
      });
      expect(usdc.derived.source.equals(treasuryUsdcAta(DEVNET_USDC_MINT))).to.equal(true);
      const sm = await buildExecuteSetMember(program, { member: buyer, proposal: m.derived.proposal, wallet: dest });
      expect(sm.derived.target.equals(memberPda(dest)[0])).to.equal(true);
   });

   it("access helpers", () => {
      const admin = Keypair.generate().publicKey;
      const authority = Keypair.generate().publicKey;
      expect(canCreatePerk({ admin }, { authority }, authority, "pass")).to.equal(false);
      expect(canCreatePerk({ admin }, { authority }, admin, "pass")).to.equal(true);
      expect(canCreatePerk({ admin }, { authority }, authority, "music")).to.equal(true);
      expect(canCreatePerk({ admin }, { authority }, buyer, "music")).to.equal(false);
      expect(canSetPerk({ admin }, { authority }, authority, { kind: perkKindArg("pass") })).to.equal(false);
      expect(canSetArtist({ admin }, { authority }, admin, true)).to.equal(false);
      expect(canSetArtist({ admin }, { authority }, admin, false)).to.equal(true);
      expect(canSetArtist({ admin }, { authority }, authority, true)).to.equal(true);
   });
});
