import { expect } from "chai";
import BN from "bn.js";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { createReadonlyProgram, IDL } from "../src/program";
import idlJson from "../idl/mostro.json";
import {
   buildBuyTokensSol,
   buildBuyTokensExactOutSol,
   buildBuyTokensUsdc,
   buildSellTokens,
   buildRedeemPerk,
   buildCreatePerk,
   buildFulfillReceipt,
   buildWithdrawArtistVault,
   buildSetCurveMetadata,
   prepareRedeemPerk,
   randomNonce,
} from "../src/ix";
import {
   artistPda,
   artistVaultPda,
   assetPda,
   ata,
   collectionPda,
   configPda,
   curvePda,
   kycPda,
   metadataPda,
   mintPda,
   perkPda,
   receiptPda,
   rewardsVaultPda,
   solVaultPda,
   treasuryPda,
   treasuryUsdcAta,
   curveUsdcVaultAta,
} from "../src/pda";
import { DEFAULT_COLLECTION_SALT, DEVNET_USDC_MINT, MPL_CORE_PROGRAM_ID, PROGRAM_ID, PYTH_SOL_USD_ACCOUNT, TOKEN_METADATA_PROGRAM_ID } from "../src/constants";
import { perkKindArg, OFFSETS, checkPerkSplit, canCreatePerk, canSetPerk, canSetArtist, expectedPaid, redeemEligibility } from "../src/accounts";

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
         solVaultPda(curve)[0],
         treasuryPda()[0],
         ata(buyer, mint),
         PROGRAM_ID /* kyc = None */,
         TOKEN_PROGRAM_ID,
         ASSOCIATED_TOKEN_PROGRAM_ID,
         SystemProgram.programId,
      ];
      instruction.keys.forEach((k, i) => expect(k.pubkey.toBase58(), `account ${i}`).to.equal(expected[i].toBase58()));
      expect(ixAccounts("buyTokensSol").slice(0, 2)).to.deep.equal(["payer", "buyer"]);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(instruction.keys[1].isSigner).to.equal(true);
      expect(instruction.keys[3].isWritable).to.equal(true);
      expect(derived.kyc).to.equal(null);
      expect(derived.payer.equals(buyer)).to.equal(true);
      // args: disc(8) + u64 + u64
      expect(instruction.data.length).to.equal(24);
      expect(new BN(instruction.data.subarray(8, 16), "le").toNumber()).to.equal(100_000_000);
   });

   it("buy_tokens_sol with kyc derives the kyc PDA", async () => {
      const { instruction, derived } = await buildBuyTokensSol(program, { buyer, curveIndex: 0, lamportsIn: 2, minTokensOut: 0, kyc: true });
      expect(derived.kyc?.equals(kycPda(buyer)[0])).to.equal(true);
      expect(instruction.keys[ixAccounts("buyTokensSol").indexOf("kyc")].pubkey.equals(kycPda(buyer)[0])).to.equal(true);
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
      // the ATA is still the buyer's, not the sponsor's
      expect(instruction.keys[ixAccounts("buyTokensSol").indexOf("buyerAta")].pubkey.equals(ata(buyer, mintPda(0)[0]))).to.equal(true);
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
      expect(instruction.keys[names.indexOf("payer")].pubkey.equals(buyer)).to.equal(true);
      const [curve] = curvePda(0);
      expect(derived.usdcVault.equals(curveUsdcVaultAta(curve, DEVNET_USDC_MINT))).to.equal(true);
      expect(derived.treasuryUsdc.equals(treasuryUsdcAta(DEVNET_USDC_MINT))).to.equal(true);
      expect(derived.buyerUsdc.equals(ata(buyer, DEVNET_USDC_MINT))).to.equal(true);
      expect(instruction.keys[names.indexOf("priceUpdate")].pubkey.equals(PYTH_SOL_USD_ACCOUNT)).to.equal(true);
      expect(instruction.keys[names.indexOf("kyc")].pubkey.equals(PROGRAM_ID)).to.equal(true);
   });

   it("sell_tokens has no payer and takes an optional kyc like buys", async () => {
      const names = ixAccounts("sellTokens");
      expect(names[0]).to.equal("seller");
      expect(names).to.include("kyc");
      const { instruction, derived } = await buildSellTokens(program, { seller: buyer, curveIndex: 0, tokensIn: 1_000_000, minLamportsOut: 1 });
      expect(instruction.keys.length).to.equal(names.length);
      expect(instruction.keys[names.indexOf("sellerAta")].pubkey.equals(derived.userAta)).to.equal(true);
      expect(instruction.keys[names.indexOf("sellerAta")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("kyc")].pubkey.equals(PROGRAM_ID)).to.equal(true);
      expect(derived.kyc).to.equal(null);

      const withKyc = await buildSellTokens(program, { seller: buyer, curveIndex: 0, tokensIn: 1, minLamportsOut: 0, kyc: true });
      expect(withKyc.derived.kyc?.equals(kycPda(buyer)[0])).to.equal(true);
      expect(withKyc.instruction.keys[names.indexOf("kyc")].pubkey.equals(kycPda(buyer)[0])).to.equal(true);
   });

   it("redeem_perk without a pass encodes None as the program id and derives asset/receipt from the nonce", async () => {
      const nonce = new BN("42");
      const { instruction, derived } = await buildRedeemPerk(program, { buyer, artistIndex: 0, perkIndex: 1, curveIndex: 0, nonce, maxPaid: 50_000_000 });
      const names = ixAccounts("redeemPerk");
      expect(instruction.keys.length).to.equal(names.length);
      expect(names.slice(0, 2)).to.deep.equal(["payer", "buyer"]);
      expect(instruction.keys[0].pubkey.equals(buyer)).to.equal(true);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(instruction.keys[1].isSigner).to.equal(true);
      expect(derived.payer.equals(buyer)).to.equal(true);
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
      expect(instruction.keys[names.indexOf("passAsset")].pubkey.equals(PROGRAM_ID)).to.equal(true);
      expect(instruction.keys[names.indexOf("passPerk")].pubkey.equals(PROGRAM_ID)).to.equal(true);
      expect(instruction.keys[names.indexOf("mplCoreProgram")].pubkey.equals(MPL_CORE_PROGRAM_ID)).to.equal(true);
      expect(instruction.keys[names.indexOf("asset")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("receipt")].isWritable).to.equal(true);
      // args: disc(8) + nonce u64 + max_paid u64
      expect(instruction.data.length).to.equal(24);
      expect(new BN(instruction.data.subarray(8, 16), "le").toString()).to.equal("42");
      expect(new BN(instruction.data.subarray(16, 24), "le").toNumber()).to.equal(50_000_000);
      expect(derived.maxPaid.toNumber()).to.equal(50_000_000);
   });

   it("redeem_perk with a pass passes both optional accounts; perk/artist/collection may be given as keys", async () => {
      const passPerk = perkPda(artistPda(0)[0], 0)[0];
      const passAsset = Keypair.generate().publicKey;
      const artist = artistPda(0)[0];
      const perk = perkPda(artist, 2)[0];
      const onChainCollection = Keypair.generate().publicKey;
      const { instruction, derived } = await buildRedeemPerk(program, {
         buyer,
         artist,
         perk,
         collection: onChainCollection,
         curveIndex: 0,
         maxPaid: 1,
         pass: { asset: passAsset, perk: passPerk },
      });
      const names = ixAccounts("redeemPerk");
      expect(instruction.keys[names.indexOf("passAsset")].pubkey.equals(passAsset)).to.equal(true);
      expect(instruction.keys[names.indexOf("passPerk")].pubkey.equals(passPerk)).to.equal(true);
      expect(instruction.keys[names.indexOf("collection")].pubkey.equals(onChainCollection)).to.equal(true);
      expect(derived.nonce.bitLength()).to.be.lte(64);
      expect(derived.perk.equals(perk)).to.equal(true);
   });

   it("collection PDA is salted; a non-default salt changes the address", async () => {
      const perk = perkPda(artistPda(0)[0], 2)[0];
      const c1 = collectionPda(perk, 1)[0];
      const c2 = collectionPda(perk, 2)[0];
      expect(c1.equals(c2)).to.equal(false);
      expect(collectionPda(perk)[0].equals(c1)).to.equal(true);
      expect(c2.equals(PublicKey.findProgramAddressSync([Buffer.from("collection"), perk.toBuffer(), new BN(2).toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0])).to.equal(true);
      const { derived } = await buildRedeemPerk(program, { buyer, artistIndex: 0, perkIndex: 2, curveIndex: 0, maxPaid: 1, collectionSalt: 2 });
      expect(derived.collection.equals(c2)).to.equal(true);
   });

   it("prepareRedeemPerk encodes the discounted price as max_paid and uses perk.collection", async () => {
      const artist = artistPda(0)[0];
      const perkKey = perkPda(artist, 2)[0];
      const collection = Keypair.generate().publicKey;
      const config = { standardDiscountBps: 500, vipDiscountBps: 1500 };
      const perk = { price: new BN(1_000_000), discountEligible: true, artist, collection };
      const r = await prepareRedeemPerk(program, config, perkKey, perk, 1, { buyer, curveIndex: 0, pass: { asset: Keypair.generate().publicKey, perk: perkPda(artist, 1)[0] } });
      expect(r.paid.toNumber()).to.equal(850_000);
      expect(r.discountBps).to.equal(1500);
      expect(new BN(r.instruction.data.subarray(16, 24), "le").toNumber()).to.equal(850_000);
      expect(r.derived.collection.equals(collection)).to.equal(true);
      const noPass = await prepareRedeemPerk(program, config, perkKey, perk, null, { buyer, curveIndex: 0 });
      expect(noPass.paid.toNumber()).to.equal(1_000_000);
      const notEligible = await prepareRedeemPerk(program, config, perkKey, { ...perk, discountEligible: false }, 0, { buyer, curveIndex: 0 });
      expect(notEligible.paid.toNumber()).to.equal(1_000_000);
      expect(notEligible.discountBps).to.equal(0);
   });

   it("redeem_perk with a sponsor payer keeps the buyer as owner of the ATA and the asset", async () => {
      const sponsor = Keypair.generate().publicKey;
      const { instruction, derived } = await buildRedeemPerk(program, { buyer, payer: sponsor, artistIndex: 0, perkIndex: 1, curveIndex: 0, nonce: 7, maxPaid: 1 });
      const names = ixAccounts("redeemPerk");
      expect(derived.payer.equals(sponsor)).to.equal(true);
      expect(instruction.keys[names.indexOf("payer")].pubkey.equals(sponsor)).to.equal(true);
      expect(instruction.keys[names.indexOf("payer")].isSigner).to.equal(true);
      expect(instruction.keys[names.indexOf("buyer")].pubkey.equals(buyer)).to.equal(true);
      expect(instruction.keys[names.indexOf("buyer")].isSigner).to.equal(true);
      expect(derived.buyerAta.equals(ata(buyer, mintPda(0)[0]))).to.equal(true);
   });

   it("random nonces are u64 and distinct", () => {
      const a = randomNonce();
      const b = randomNonce();
      expect(a.bitLength()).to.be.lte(64);
      expect(a.eq(b)).to.equal(false);
   });

   it("create_perk encodes the enum arg and the collection salt, derives collection + artist vault", async () => {
      expect(typeFields("CreatePerkArgs").slice(-1)).to.deep.equal(["collectionSalt"]);
      const { instruction, derived } = await buildCreatePerk(program, {
         signer: buyer,
         artistIndex: 0,
         perkIndex: 0,
         curveIndex: 0,
         args: {
            kind: perkKindArg("pass"),
            tier: 1,
            price: 3_750_000_000,
            burnBps: 8000,
            rewardsBps: 2000,
            maxSupply: 0,
            publicStartTs: 0,
            vipOnly: false,
            discountEligible: false,
            name: "MoOG Pass VIP",
            uri: "https://example.com/vip.json",
            collectionSalt: 7,
         },
      });
      expect(instruction.keys.length).to.equal(ixAccounts("createPerk").length);
      expect(derived.collection.equals(collectionPda(derived.perk, 7)[0])).to.equal(true);
      expect(derived.collection.equals(collectionPda(derived.perk)[0])).to.equal(false);
      // decode back through the coder to make sure the enum and the salt went through
      const decoded = new BorshInstructionCoder(program.idl).decode(instruction.data) as {
         name: string;
         data: { args: { kind: Record<string, unknown>; tier: number; price: BN; collectionSalt: BN } };
      } | null;
      if (!decoded) throw new Error("decode failed");
      expect(decoded.name).to.equal("createPerk");
      expect(Object.keys(decoded.data.args.kind)[0].toLowerCase()).to.equal("pass");
      expect(decoded.data.args.tier).to.equal(1);
      expect(decoded.data.args.price.toString()).to.equal("3750000000");
      expect(decoded.data.args.collectionSalt.toNumber()).to.equal(7);

      const def = await buildCreatePerk(program, {
         signer: buyer,
         artistIndex: 0,
         perkIndex: 0,
         curveIndex: 0,
         args: {
            ...{
               kind: perkKindArg("music"),
               tier: 0,
               price: 1,
               burnBps: 0,
               rewardsBps: 0,
               maxSupply: 0,
               publicStartTs: 0,
               vipOnly: false,
               discountEligible: true,
               name: "x",
               uri: "u",
            },
         },
      });
      expect(def.derived.collection.equals(collectionPda(def.derived.perk, DEFAULT_COLLECTION_SALT)[0])).to.equal(true);
   });

   it("kyc on buys and sells has no PDA seeds in the IDL (clients may omit it)", () => {
      for (const ix of ["buyTokensSol", "buyTokensExactOutSol", "buyTokensUsdc", "sellTokens"]) {
         const raw = idlJson.instructions.find((i) => i.name === snake(ix)) as unknown as { accounts: { name: string; optional?: boolean; pda?: unknown }[] };
         const kyc = raw.accounts.find((a) => a.name === "kyc");
         if (!kyc) throw new Error(`no kyc on ${ix}`);
         expect(kyc.optional, ix).to.equal(true);
         expect(kyc.pda, ix).to.equal(undefined);
      }
   });

   it("access helpers: set_perk on a pass is admin-only, set_artist(authority) is current-authority-only, expectedPaid, inactive pass tier", () => {
      const admin = Keypair.generate().publicKey;
      const authority = Keypair.generate().publicKey;
      const pass = { kind: perkKindArg("pass") };
      const music = { kind: perkKindArg("music") };
      expect(canSetPerk({ admin }, { authority }, authority, pass)).to.equal(false);
      expect(canSetPerk({ admin }, { authority }, admin, pass)).to.equal(true);
      expect(canSetPerk({ admin }, { authority }, authority, music)).to.equal(true);
      expect(canSetArtist({ admin }, { authority }, admin, false)).to.equal(true);
      expect(canSetArtist({ admin }, { authority }, admin, true)).to.equal(false);
      expect(canSetArtist({ admin }, { authority }, authority, true)).to.equal(true);
      expect(canSetArtist({ admin }, { authority }, Keypair.generate().publicKey, false)).to.equal(false);

      const cfg = { standardDiscountBps: 500, vipDiscountBps: 1500 };
      expect(expectedPaid(cfg, { price: new BN(1_200_000_000), discountEligible: true }, 0).paid.toString()).to.equal("1140000000");
      expect(expectedPaid(cfg, { price: new BN(1_200_000_000), discountEligible: true }, 1).paid.toString()).to.equal("1020000000");
      expect(expectedPaid(cfg, { price: new BN(1_200_000_000), discountEligible: false }, 1).paid.toString()).to.equal("1200000000");
      expect(expectedPaid(cfg, { price: new BN(1_200_000_000), discountEligible: true }, null).discountBps).to.equal(0);

      const ecfg = { paused: false, standardEarlySecs: 86_400, vipEarlySecs: 259_200 };
      const perk = { active: true, maxSupply: 0, sold: 0, vipOnly: false, publicStartTs: new BN(0) };
      expect(redeemEligibility(ecfg, perk, true, 0, 1_000, false).reason).to.equal("PassPerkInactive");
      expect(redeemEligibility(ecfg, perk, true, null, 1_000, false).ok).to.equal(true);
      expect(redeemEligibility(ecfg, perk, true, 0, 1_000).ok).to.equal(true);
   });

   it("errors: PriceUncertain is 6031 and the IDL has 32 errors / 17 events", () => {
      expect(idlJson.errors.length).to.equal(32);
      expect(idlJson.errors.find((e) => e.code === 6031)?.name).to.equal("PriceUncertain");
      const events = (idlJson as unknown as { events: { name: string }[] }).events.map((e) => e.name);
      expect(events.length).to.equal(17);
      for (const e of ["AdminTransferCancelled", "TreasuryWithdrawn", "ArtistUpdated", "ArtistVaultWithdrawn", "PerkUpdated"]) expect(events).to.include(e);
   });

   it("fulfill_receipt by asset", async () => {
      const asset = Keypair.generate().publicKey;
      const { derived } = await buildFulfillReceipt(program, { signer: buyer, artistIndex: 0, receipt: asset, by: "asset" });
      expect(derived.receipt.equals(receiptPda(asset)[0])).to.equal(true);
   });

   it("withdraw_artist_vault is signed by the artist authority alone (no config, no admin path)", async () => {
      const names = ixAccounts("withdrawArtistVault");
      expect(names).to.deep.equal(["authority", "artist", "mint", "artistVault", "destination", "tokenProgram"]);
      const { instruction, derived } = await buildWithdrawArtistVault(program, { authority: buyer, artistIndex: 0, curveIndex: 0, amount: 5 });
      expect(instruction.keys.length).to.equal(names.length);
      const artist = artistPda(0)[0];
      const mint = mintPda(0)[0];
      expect(instruction.keys[0].pubkey.equals(buyer)).to.equal(true);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(derived.artistVault.equals(artistVaultPda(artist, mint)[0])).to.equal(true);
      expect(derived.destination.equals(ata(buyer, mint))).to.equal(true);
      expect(instruction.keys[names.indexOf("artistVault")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("destination")].isWritable).to.equal(true);
      expect(new BN(instruction.data.subarray(8, 16), "le").toNumber()).to.equal(5);
   });

   it("set_curve_metadata derives the Token Metadata PDA under the metadata program", async () => {
      const names = ixAccounts("setCurveMetadata");
      expect(names).to.deep.equal(["admin", "config", "curve", "mint", "metadata", "tokenMetadataProgram", "systemProgram", "rent"]);
      const admin = Keypair.generate().publicKey;
      const { instruction, derived } = await buildSetCurveMetadata(program, { admin, curveIndex: 0 });
      const mint = mintPda(0)[0];
      const expectedMeta = PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], TOKEN_METADATA_PROGRAM_ID)[0];
      expect(derived.metadata.equals(expectedMeta)).to.equal(true);
      expect(metadataPda(mint)[0].equals(expectedMeta)).to.equal(true);
      expect(instruction.keys.length).to.equal(names.length);
      expect(instruction.keys[0].pubkey.equals(admin)).to.equal(true);
      expect(instruction.keys[0].isSigner).to.equal(true);
      expect(instruction.keys[0].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("mint")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("metadata")].isWritable).to.equal(true);
      expect(instruction.keys[names.indexOf("tokenMetadataProgram")].pubkey.toBase58()).to.equal("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
      expect(instruction.keys[names.indexOf("rent")].pubkey.toBase58()).to.equal("SysvarRent111111111111111111111111111111111");
      // no args: data is the 8-byte discriminator only
      expect(instruction.data.length).to.equal(8);
   });

   it("config args carry the split floors and Config stores them", () => {
      expect(typeFields("InitializeConfigArgs").slice(-2)).to.deep.equal(["minBurnBps", "minRewardsBps"]);
      expect(typeFields("SetConfigArgs").slice(-2)).to.deep.equal(["minBurnBps", "minRewardsBps"]);
      const cfg = typeFields("Config");
      expect(cfg).to.include("minBurnBps");
      expect(cfg).to.include("minRewardsBps");
      // The two u16 came out of the padding: `_reserved` shrank from 64 to 60 bytes, so Config's size is unchanged.
      const raw = idlJson.types.find((t) => t.name === "Config") as unknown as { type: { fields: { name: string; type: unknown }[] } };
      const reserved = raw.type.fields[raw.type.fields.length - 1];
      expect(reserved.name).to.equal("_reserved");
      expect(reserved.type).to.deep.equal({ array: ["u8", 60] });
   });

   it("checkPerkSplit and canCreatePerk mirror create_perk gating", () => {
      const floors = { minBurnBps: 5000, minRewardsBps: 1000 };
      expect(checkPerkSplit(floors, 8000, 2000)).to.deep.equal({ ok: true, reason: null });
      expect(checkPerkSplit(floors, 4999, 2000).reason).to.equal("BurnBelowFloor");
      expect(checkPerkSplit(floors, 8000, 999).reason).to.equal("RewardsBelowFloor");
      expect(checkPerkSplit(floors, 8000, 3000).reason).to.equal("SumExceeds");
      expect(checkPerkSplit({ minBurnBps: 0, minRewardsBps: 0 }, 0, 0).ok).to.equal(true);

      const admin = Keypair.generate().publicKey;
      const authority = Keypair.generate().publicKey;
      const stranger = Keypair.generate().publicKey;
      expect(canCreatePerk({ admin }, { authority }, admin, "pass")).to.equal(true);
      expect(canCreatePerk({ admin }, { authority }, authority, "pass")).to.equal(false);
      expect(canCreatePerk({ admin }, { authority }, authority, "music")).to.equal(true);
      expect(canCreatePerk({ admin }, { authority }, admin, "music")).to.equal(true);
      expect(canCreatePerk({ admin }, { authority }, stranger, "music")).to.equal(false);
   });

   it("account layout offsets match the IDL types", () => {
      // Receipt: disc(8) bump(1) version(1) buyer(32) perk(32) artist(32) asset(32)
      const fields = typeFields("Receipt");
      expect(fields.slice(0, 6)).to.deep.equal(["bump", "version", "buyer", "perk", "artist", "asset"]);
      expect(OFFSETS.receipt).to.deep.equal({ buyer: 10, perk: 42, artist: 74, asset: 106 });
      const pf = typeFields("Perk");
      expect(pf.slice(0, 6)).to.deep.equal(["bump", "version", "index", "artist", "mint", "collection"]);
      expect(OFFSETS.perk).to.deep.equal({ index: 10, artist: 14, mint: 46, collection: 78 });
      expect(PublicKey.default.toBase58()).to.equal("11111111111111111111111111111111");
   });
});
