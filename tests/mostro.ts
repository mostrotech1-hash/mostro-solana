import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAsset, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey as umiPk } from "@metaplex-foundation/umi";
import { assert, expect } from "chai";
import { Mostro } from "../shared/types/mostro";
import idl from "../shared/idl/mostro.json";

// ---------- constants ----------
const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PYTH_SOL_USD = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const PYTH_FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const TOKEN = 1_000_000; // 6 decimals
const VQ0 = new BN(30_000_000_000);
const VT0 = new BN(1_000_000_000_000);
const CAP = new BN(800_000_000_000);
const FEE_BPS = 100;

// ---------- curve mirror (same integer math as curve.rs) ----------
const BPS = new BN(10_000);
function quoteBuyExactIn(vq: BN, vt: BN, q: BN, feeBps: number) {
   const net = q.subn(1).mul(BPS).div(BPS.addn(feeBps));
   const out = net.mul(vt).div(vq.add(net));
   return { net, fee: q.sub(net), out };
}
function quoteBuyExactOut(vq: BN, vt: BN, t: BN, feeBps: number) {
   const cost = t.mul(vq).div(vt.sub(t)).addn(1);
   const fee = cost.muln(feeBps).add(BPS.subn(1)).div(BPS);
   return { cost, fee };
}
function quoteSell(vq: BN, vt: BN, t: BN, feeBps: number) {
   const out = t.mul(vq).div(vt.add(t));
   const fee = out.muln(feeBps).add(BPS.subn(1)).div(BPS);
   return { gross: out, fee, net: out.sub(fee) };
}

// ---------- helpers ----------
const u32le = (n: number) => {
   const b = Buffer.alloc(4);
   b.writeUInt32LE(n);
   return b;
};
const u64le = (n: BN) => n.toArrayLike(Buffer, "le", 8);

async function expectError(p: Promise<unknown>, code: string) {
   try {
      await p;
   } catch (e: any) {
      const msg = String(e?.error?.errorCode?.code ?? e?.message ?? e);
      expect(msg, `expected ${code}, got: ${msg}`).to.include(code);
      return;
   }
   assert.fail(`expected error ${code}`);
}

const cfgArgs = (partial: Record<string, unknown>) => ({
   paused: null,
   kycRequired: null,
   priceMode: null,
   solUsdPriceE6: null,
   pythSolUsdAccount: null,
   pythFeedId: null,
   maxPriceAgeSecs: null,
   feeBps: null,
   standardDiscountBps: null,
   vipDiscountBps: null,
   standardEarlySecs: null,
   vipEarlySecs: null,
   minBurnBps: null,
   minRewardsBps: null,
   adminPriceMaxAgeSecs: null,
   ...partial,
});

// Makes an otherwise identical transaction unique (avoids "already processed").
const uniq = () => anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 + Math.floor(Math.random() * 1_000_000) });

async function rpc(conn: anchor.web3.Connection, method: string, params: unknown[]) {
   const res = await fetch(conn.rpcEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
   });
   const j: any = await res.json();
   if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error)}`);
   return j.result;
}

describe("mostro", () => {
   const provider = anchor.AnchorProvider.env();
   anchor.setProvider(provider);
   // Built from the committed IDL (shared/) so the suite does not depend on a local anchor build.
   const program = new Program<Mostro>(idl as Mostro, provider);
   const conn = provider.connection;
   const admin = (provider.wallet as anchor.Wallet).payer;
   const buyer = Keypair.generate();
   const other = Keypair.generate();
   const artistAuthority = Keypair.generate();
   const umi = createUmi(conn.rpcEndpoint).use(mplCore());

   // PDAs
   const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
   const [treasury] = PublicKey.findProgramAddressSync([Buffer.from("treasury")], program.programId);
   const [programData] = PublicKey.findProgramAddressSync([program.programId.toBuffer()], BPF_UPGRADEABLE);
   const treasuryUsdc = getAssociatedTokenAddressSync(USDC_DEVNET, config, true);
   const [curve] = PublicKey.findProgramAddressSync([Buffer.from("curve"), u32le(0)], program.programId);
   const [mint] = PublicKey.findProgramAddressSync([Buffer.from("mint"), u32le(0)], program.programId);
   const [solVault] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault"), curve.toBuffer()], program.programId);
   const [rewardsVault] = PublicKey.findProgramAddressSync([Buffer.from("rewards"), curve.toBuffer()], program.programId);
   const usdcVault = getAssociatedTokenAddressSync(USDC_DEVNET, curve, true);
   const [artist] = PublicKey.findProgramAddressSync([Buffer.from("artist"), u32le(0)], program.programId);
   const [artistVault] = PublicKey.findProgramAddressSync([Buffer.from("artist_vault"), artist.toBuffer(), mint.toBuffer()], program.programId);
   const perkPda = (i: number) => PublicKey.findProgramAddressSync([Buffer.from("perk"), artist.toBuffer(), u32le(i)], program.programId)[0];
   const COLLECTION_SALT = new BN(1);
   const collectionPda = (perk: PublicKey, salt: BN = COLLECTION_SALT) =>
      PublicKey.findProgramAddressSync([Buffer.from("collection"), perk.toBuffer(), u64le(salt)], program.programId)[0];
   const assetPda = (perk: PublicKey, nonce: BN) => PublicKey.findProgramAddressSync([Buffer.from("asset"), perk.toBuffer(), u64le(nonce)], program.programId)[0];
   const receiptPda = (asset: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("receipt"), asset.toBuffer()], program.programId)[0];
   const kycPda = (w: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("kyc"), w.toBuffer()], program.programId)[0];
   const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner);

   // perk indexes created in "creates perks"
   const PASS_STD = 0,
      PASS_VIP = 1,
      MUSIC = 2,
      EVENT = 3,
      MERCH = 4,
      VIP_ONLY = 5;
   let nonceCounter = new BN(Date.now());
   const nextNonce = () => (nonceCounter = nonceCounter.addn(1));

   const buyAccounts = (who: PublicKey) => ({
      payer: who,
      buyer: who,
      config,
      curve,
      mint,
      solVault,
      treasury,
      buyerAta: ata(who),
      kyc: null,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
   });

   async function redeem(who: Keypair, perkIndex: number, pass?: { asset: PublicKey; perkIndex: number }, maxPaid?: BN) {
      const perk = perkPda(perkIndex);
      const nonce = nextNonce();
      const cap = maxPaid ?? (await program.account.perk.fetch(perk)).price;
      const asset = assetPda(perk, nonce);
      const receipt = receiptPda(asset);
      await program.methods
         .redeemPerk(nonce, cap)
         .accountsPartial({
            payer: who.publicKey,
            buyer: who.publicKey,
            config,
            artist,
            perk,
            curve,
            mint,
            buyerAta: ata(who.publicKey),
            rewardsVault,
            artistVault,
            collection: collectionPda(perk),
            asset,
            receipt,
            passAsset: pass ? pass.asset : null,
            passPerk: pass ? perkPda(pass.perkIndex) : null,
            mplCoreProgram: MPL_CORE,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .preInstructions([anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
         .signers([who])
         .rpc();
      return { perk, asset, receipt, nonce };
   }

   async function buyExactOut(who: Keypair, tokens: BN) {
      const c = await program.account.curve.fetch(curve);
      const q = quoteBuyExactOut(c.virtualSolReserves, c.virtualTokenReserves, tokens, FEE_BPS);
      await program.methods.buyTokensExactOutSol(tokens, q.cost.add(q.fee).muln(101).divn(100)).accountsPartial(buyAccounts(who.publicKey)).signers([who]).rpc();
   }

   // The fork mirrors devnet, where the program is already seeded. On surfpool, reset every PDA the
   // suite initializes so it always starts from a blank protocol. No-op on other validators.
   async function wipeForkState() {
      const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), mint.toBuffer()], TOKEN_METADATA);
      const targets = [config, treasury, treasuryUsdc, curve, mint, solVault, rewardsVault, usdcVault, artist, artistVault, metadata];
      for (let i = 0; i < 8; i++) {
         const perk = perkPda(i);
         targets.push(perk, collectionPda(perk));
      }
      try {
         for (const t of targets) {
            await rpc(conn, "surfnet_setAccount", [t.toBase58(), { lamports: 0, data: "", owner: SystemProgram.programId.toBase58(), executable: false, rentEpoch: 0 }]);
         }
      } catch (e) {
         // not surfpool: assume a clean validator
      }
   }

   before(async () => {
      await wipeForkState();
      for (const k of [buyer, other, artistAuthority]) {
         const sig = await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL);
         await conn.confirmTransaction(sig, "confirmed");
      }
   });

   it("initializes config (payer must be the upgrade authority)", async () => {
      await program.methods
         .initializeConfig({
            admin: admin.publicKey,
            feeBps: FEE_BPS,
            solUsdPriceE6: new BN(112_000_000),
            maxPriceAgeSecs: 300,
            pythSolUsdAccount: PYTH_SOL_USD,
            pythFeedId: Array.from(PYTH_FEED),
            adminCooloffSecs: 2,
            minBurnBps: 0,
            minRewardsBps: 0,
            adminPriceMaxAgeSecs: 86_400,
         })
         .accountsPartial({
            payer: admin.publicKey,
            config,
            treasury,
            usdcMint: USDC_DEVNET,
            treasuryUsdc,
            program: program.programId,
            programData,
            usdcTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .rpc();
      const c = await program.account.config.fetch(config);
      expect(c.admin.toBase58()).to.eq(admin.publicKey.toBase58());
      expect(c.feeBps).to.eq(FEE_BPS);
      expect(c.priceMode).to.eq(0);
      expect(c.standardDiscountBps).to.eq(500);
      expect(c.vipDiscountBps).to.eq(1500);
      expect(c.vipEarlySecs).to.eq(259_200);
   });

   it("rejects config changes from a non-admin", async () => {
      await expectError(
         program.methods
            .setConfig(cfgArgs({ paused: true }) as any)
            .accountsPartial({ admin: other.publicKey, config })
            .signers([other])
            .rpc(),
         "Unauthorized",
      );
   });

   it("rejects a zero admin price window", async () => {
      await expectError(
         program.methods
            .setConfig(cfgArgs({ adminPriceMaxAgeSecs: 0 }) as any)
            .accountsPartial({ admin: admin.publicKey, config })
            .rpc(),
         "InvalidAmount",
      );
   });

   it("creates the $MOST curve", async () => {
      await program.methods
         .createCurve({
            name: "Mostro",
            symbol: "MOST",
            uri: "https://mostro.xyz/most.json",
            virtualSolReserves: VQ0,
            virtualTokenReserves: VT0,
            supplyCap: CAP,
            saleStartTs: new BN(0),
         })
         .accountsPartial({
            admin: admin.publicKey,
            config,
            curve,
            mint,
            solVault,
            rewardsVault,
            usdcMint: USDC_DEVNET,
            usdcVault,
            tokenProgram: TOKEN_PROGRAM_ID,
            usdcTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .rpc();
      const c = await program.account.curve.fetch(curve);
      expect(c.mint.toBase58()).to.eq(mint.toBase58());
      expect(c.virtualSolReserves.eq(VQ0)).to.be.true;
      const m = await getMint(conn, mint);
      expect(m.decimals).to.eq(6);
      expect(m.mintAuthority?.toBase58()).to.eq(curve.toBase58());
      const vaultLamports = await conn.getBalance(solVault);
      expect(vaultLamports).to.be.greaterThan(0);
      await expectError(
         program.methods
            .createCurve({ name: "x", symbol: "X", uri: "u", virtualSolReserves: VQ0, virtualTokenReserves: VT0, supplyCap: VT0, saleStartTs: new BN(0) })
            .accountsPartial({
               admin: admin.publicKey,
               config,
               curve: PublicKey.findProgramAddressSync([Buffer.from("curve"), u32le(1)], program.programId)[0],
               mint: PublicKey.findProgramAddressSync([Buffer.from("mint"), u32le(1)], program.programId)[0],
               solVault: PublicKey.findProgramAddressSync(
                  [Buffer.from("sol_vault"), PublicKey.findProgramAddressSync([Buffer.from("curve"), u32le(1)], program.programId)[0].toBuffer()],
                  program.programId,
               )[0],
               rewardsVault: PublicKey.findProgramAddressSync(
                  [Buffer.from("rewards"), PublicKey.findProgramAddressSync([Buffer.from("curve"), u32le(1)], program.programId)[0].toBuffer()],
                  program.programId,
               )[0],
               usdcMint: USDC_DEVNET,
               usdcVault: getAssociatedTokenAddressSync(USDC_DEVNET, PublicKey.findProgramAddressSync([Buffer.from("curve"), u32le(1)], program.programId)[0], true),
               tokenProgram: TOKEN_PROGRAM_ID,
               usdcTokenProgram: TOKEN_PROGRAM_ID,
               associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
               systemProgram: SystemProgram.programId,
            })
            .rpc(),
         "InvalidCurveParams",
      );
   });

   it("attaches token metadata to $MOST (admin only)", async () => {
      const [metadata] = PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), mint.toBuffer()], TOKEN_METADATA);
      await expectError(
         program.methods
            .setCurveMetadata()
            .accountsPartial({
               admin: other.publicKey,
               config,
               curve,
               mint,
               metadata,
               tokenMetadataProgram: TOKEN_METADATA,
               systemProgram: SystemProgram.programId,
               rent: anchor.web3.SYSVAR_RENT_PUBKEY,
            })
            .signers([other])
            .rpc(),
         "Unauthorized",
      );
      await program.methods
         .setCurveMetadata()
         .accountsPartial({
            admin: admin.publicKey,
            config,
            curve,
            mint,
            metadata,
            tokenMetadataProgram: TOKEN_METADATA,
            systemProgram: SystemProgram.programId,
            rent: anchor.web3.SYSVAR_RENT_PUBKEY,
         })
         .rpc();
      const info = await conn.getAccountInfo(metadata);
      assert(info, "metadata account must exist");
      expect(info.owner.toBase58()).to.eq(TOKEN_METADATA.toBase58());
      expect(info.data.toString("utf8")).to.include("Mostro");
      expect(info.data.toString("utf8")).to.include("MOST");
   });

   it("buys $MOST with SOL at the quoted amount", async () => {
      const lamportsIn = new BN(0.1 * LAMPORTS_PER_SOL);
      const before = await program.account.curve.fetch(curve);
      const q = quoteBuyExactIn(before.virtualSolReserves, before.virtualTokenReserves, lamportsIn, FEE_BPS);
      const treasuryBefore = await conn.getBalance(treasury);
      const vaultBefore = await conn.getBalance(solVault);
      await program.methods.buyTokensSol(lamportsIn, q.out).accountsPartial(buyAccounts(buyer.publicKey)).signers([buyer]).rpc();
      const acc = await getAccount(conn, ata(buyer.publicKey));
      expect(acc.amount.toString()).to.eq(q.out.toString());
      expect(await conn.getBalance(treasury)).to.eq(treasuryBefore + q.fee.toNumber());
      expect(await conn.getBalance(solVault)).to.eq(vaultBefore + q.net.toNumber());
      const after = await program.account.curve.fetch(curve);
      expect(after.tokensSold.eq(q.out)).to.be.true;
      expect(after.realSolReserves.eq(q.net)).to.be.true;
      // ~3,290 tokens at genesis of set B
      expect(q.out.toNumber()).to.be.within(3_289 * TOKEN, 3_291 * TOKEN);
   });

   it("enforces slippage", async () => {
      await expectError(
         program.methods
            .buyTokensSol(new BN(LAMPORTS_PER_SOL), new BN(10_000_000 * TOKEN))
            .accountsPartial(buyAccounts(buyer.publicKey))
            .signers([buyer])
            .rpc(),
         "SlippageExceeded",
      );
   });

   it("buys an exact number of tokens", async () => {
      const want = new BN(1_000 * TOKEN);
      const before = await getAccount(conn, ata(buyer.publicKey));
      await buyExactOut(buyer, want);
      const after = await getAccount(conn, ata(buyer.publicKey));
      expect((after.amount - before.amount).toString()).to.eq(want.toString());
   });

   it("sells tokens back for less than paid", async () => {
      const c = await program.account.curve.fetch(curve);
      const t = new BN(500 * TOKEN);
      const q = quoteSell(c.virtualSolReserves, c.virtualTokenReserves, t, FEE_BPS);
      const balBefore = await conn.getBalance(buyer.publicKey);
      await program.methods
         .sellTokens(t, q.net)
         .accountsPartial({
            seller: buyer.publicKey,
            config,
            curve,
            mint,
            solVault,
            treasury,
            sellerAta: ata(buyer.publicKey),
            kyc: null,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .signers([buyer])
         .rpc();
      const balAfter = await conn.getBalance(buyer.publicKey);
      expect(balAfter - balBefore).to.be.within(q.net.toNumber() - 10_000, q.net.toNumber());
      const c2 = await program.account.curve.fetch(curve);
      expect(c.tokensSold.sub(c2.tokensSold).eq(t)).to.be.true;
   });

   it("buys with USDC through the admin SOL/USD price", async () => {
      await rpc(conn, "surfnet_setTokenAccount", [buyer.publicKey.toBase58(), USDC_DEVNET.toBase58(), { amount: 50_000_000 }]);
      const buyerUsdc = getAssociatedTokenAddressSync(USDC_DEVNET, buyer.publicKey);
      const usdcIn = new BN(10_000_000); // $10
      const cfg = await program.account.config.fetch(config);
      const lamportsEquiv = usdcIn.mul(new BN(1_000_000_000)).div(cfg.solUsdPriceE6);
      const c = await program.account.curve.fetch(curve);
      const q = quoteBuyExactIn(c.virtualSolReserves, c.virtualTokenReserves, lamportsEquiv, FEE_BPS);
      const before = await getAccount(conn, ata(buyer.publicKey));
      await program.methods
         .buyTokensUsdc(usdcIn, q.out)
         .accountsPartial({
            payer: buyer.publicKey,
            buyer: buyer.publicKey,
            config,
            curve,
            mint,
            usdcMint: USDC_DEVNET,
            buyerUsdc,
            usdcVault,
            treasuryUsdc,
            buyerAta: ata(buyer.publicKey),
            priceUpdate: PYTH_SOL_USD,
            kyc: null,
            tokenProgram: TOKEN_PROGRAM_ID,
            usdcTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .signers([buyer])
         .rpc();
      const after = await getAccount(conn, ata(buyer.publicKey));
      expect((after.amount - before.amount).toString()).to.eq(q.out.toString());
      const vault = await getAccount(conn, usdcVault);
      const tre = await getAccount(conn, treasuryUsdc);
      expect(Number(vault.amount) + Number(tre.amount)).to.eq(usdcIn.toNumber());
      expect(Number(tre.amount)).to.be.greaterThan(0);
   });

   it("reads the Pyth price in mode 1 (or rejects a stale feed)", async () => {
      await program.methods
         .setConfig(cfgArgs({ priceMode: 1 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      const buyerUsdc = getAssociatedTokenAddressSync(USDC_DEVNET, buyer.publicKey);
      const info = await conn.getAccountInfo(PYTH_SOL_USD);
      assert(info, "pyth account must be cloned from devnet");
      const publishTime = Number(info.data.readBigInt64LE(93));
      const fresh = Math.floor(Date.now() / 1000) - publishTime <= 300;
      const tx = program.methods
         .buyTokensUsdc(new BN(1_000_000), new BN(0))
         .accountsPartial({
            payer: buyer.publicKey,
            buyer: buyer.publicKey,
            config,
            curve,
            mint,
            usdcMint: USDC_DEVNET,
            buyerUsdc,
            usdcVault,
            treasuryUsdc,
            buyerAta: ata(buyer.publicKey),
            priceUpdate: PYTH_SOL_USD,
            kyc: null,
            tokenProgram: TOKEN_PROGRAM_ID,
            usdcTokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .signers([buyer])
         .rpc();
      if (fresh) {
         await tx;
      } else {
         await expectError(tx, "PriceTooOld");
      }
      // wrong account in mode 1 is rejected regardless of freshness
      await expectError(
         program.methods
            .buyTokensUsdc(new BN(1_000_000), new BN(0))
            .accountsPartial({
               payer: buyer.publicKey,
               buyer: buyer.publicKey,
               config,
               curve,
               mint,
               usdcMint: USDC_DEVNET,
               buyerUsdc,
               usdcVault,
               treasuryUsdc,
               buyerAta: ata(buyer.publicKey),
               priceUpdate: config,
               kyc: null,
               tokenProgram: TOKEN_PROGRAM_ID,
               usdcTokenProgram: TOKEN_PROGRAM_ID,
               associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
               systemProgram: SystemProgram.programId,
            })
            .signers([buyer])
            .rpc(),
         "InvalidPriceAccount",
      );
      await program.methods
         .setConfig(cfgArgs({ priceMode: 0 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   it("creates an artist and its perks", async () => {
      await program.methods
         .createArtist(artistAuthority.publicKey, "MoOG", "https://mostro.xyz/artists/moog.json")
         .accountsPartial({ admin: admin.publicKey, config, artist, systemProgram: SystemProgram.programId })
         .rpc();
      const now = Math.floor(Date.now() / 1000);
      const perks = [
         { kind: { pass: {} as any }, tier: 0, price: 1_200, burn: 8000, rewards: 2000, max: 0, start: 0, vipOnly: false, disc: false, name: "MoOG Pass Standard" },
         { kind: { pass: {} as any }, tier: 1, price: 3_750, burn: 8000, rewards: 2000, max: 0, start: 0, vipOnly: false, disc: false, name: "MoOG Pass VIP" },
         { kind: { music: {} as any }, tier: 0, price: 50, burn: 8000, rewards: 2000, max: 0, start: 0, vipOnly: false, disc: true, name: "Unreleased track" },
         { kind: { event: {} as any }, tier: 0, price: 900, burn: 8000, rewards: 2000, max: 0, start: now + 2 * 86_400, vipOnly: false, disc: false, name: "Listening session" },
         { kind: { merch: {} as any }, tier: 0, price: 1_500, burn: 7000, rewards: 2000, max: 1, start: 0, vipOnly: false, disc: true, name: "Numbered tee" },
         { kind: { event: {} as any }, tier: 0, price: 10, burn: 8000, rewards: 2000, max: 0, start: 0, vipOnly: true, disc: false, name: "Members-only moment" },
      ];
      // an artist cannot mint itself a Pass perk (protocol-wide benefits are admin-only)
      await expectError(
         program.methods
            .createPerk({
               kind: { pass: {} } as any,
               tier: 0,
               price: new BN(1),
               burnBps: 0,
               rewardsBps: 0,
               maxSupply: 0,
               publicStartTs: new BN(0),
               vipOnly: false,
               discountEligible: false,
               name: "fake pass",
               uri: "u",
               collectionSalt: COLLECTION_SALT,
            })
            .accountsPartial({
               signer: artistAuthority.publicKey,
               config,
               artist,
               curve,
               mint,
               perk: perkPda(0),
               collection: collectionPda(perkPda(0)),
               artistVault,
               mplCoreProgram: MPL_CORE,
               tokenProgram: TOKEN_PROGRAM_ID,
               systemProgram: SystemProgram.programId,
            })
            .signers([artistAuthority])
            .rpc(),
         "Unauthorized",
      );
      for (let i = 0; i < perks.length; i++) {
         const p = perks[i];
         const perk = perkPda(i);
         const creator = p.kind.pass ? admin : artistAuthority;
         await program.methods
            .createPerk({
               kind: p.kind as any,
               tier: p.tier,
               price: new BN(p.price * TOKEN),
               burnBps: p.burn,
               rewardsBps: p.rewards,
               maxSupply: p.max,
               publicStartTs: new BN(p.start),
               vipOnly: p.vipOnly,
               discountEligible: p.disc,
               name: p.name,
               uri: `https://mostro.xyz/perks/${i}.json`,
               collectionSalt: COLLECTION_SALT,
            })
            .accountsPartial({
               signer: creator.publicKey,
               config,
               artist,
               curve,
               mint,
               perk,
               collection: collectionPda(perk),
               artistVault,
               mplCoreProgram: MPL_CORE,
               tokenProgram: TOKEN_PROGRAM_ID,
               systemProgram: SystemProgram.programId,
            })
            .signers([creator])
            .rpc();
      }
      const a = await program.account.artist.fetch(artist);
      expect(a.perkCount).to.eq(perks.length);
      const col = await fetchCollection(umi, umiPk(collectionPda(perkPda(PASS_VIP)).toBase58()));
      expect(col.name).to.eq("MoOG Pass VIP");
      expect(col.updateAuthority.toString()).to.eq(artist.toBase58());
      // a random wallet cannot create perks for this artist
      await expectError(
         program.methods
            .createPerk({
               kind: { music: {} } as any,
               tier: 0,
               price: new BN(1),
               burnBps: 0,
               rewardsBps: 0,
               maxSupply: 0,
               publicStartTs: new BN(0),
               vipOnly: false,
               discountEligible: false,
               name: "x",
               uri: "u",
               collectionSalt: COLLECTION_SALT,
            })
            .accountsPartial({
               signer: other.publicKey,
               config,
               artist,
               curve,
               mint,
               perk: perkPda(perks.length),
               collection: collectionPda(perkPda(perks.length)),
               artistVault,
               mplCoreProgram: MPL_CORE,
               tokenProgram: TOKEN_PROGRAM_ID,
               systemProgram: SystemProgram.programId,
            })
            .signers([other])
            .rpc(),
         "Unauthorized",
      );
   });

   it("keeps pass perks admin-only for edits too", async () => {
      await expectError(
         program.methods
            .setPerk({
               price: new BN(1),
               active: null,
               maxSupply: null,
               publicStartTs: null,
               vipOnly: null,
               discountEligible: null,
               burnBps: null,
               rewardsBps: null,
               uri: null,
            } as any)
            .accountsPartial({ signer: artistAuthority.publicKey, config, artist, perk: perkPda(PASS_VIP) })
            .signers([artistAuthority])
            .rpc(),
         "Unauthorized",
      );
      // and the admin cannot take over an artist by rewriting its authority
      await expectError(
         program.methods
            .setArtist({ authority: admin.publicKey, name: null, uri: null, active: null } as any)
            .accountsPartial({ signer: admin.publicKey, config, artist })
            .rpc(),
         "Unauthorized",
      );
   });

   it("enforces the protocol floor on perk splits", async () => {
      await program.methods
         .setConfig(cfgArgs({ minBurnBps: 5000, minRewardsBps: 1000 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      await expectError(
         program.methods
            .setPerk({ price: null, active: null, maxSupply: null, publicStartTs: null, vipOnly: null, discountEligible: null, burnBps: 1000, rewardsBps: null, uri: null } as any)
            .accountsPartial({ signer: artistAuthority.publicKey, config, artist, perk: perkPda(MUSIC) })
            .signers([artistAuthority])
            .rpc(),
         "InvalidBps",
      );
      await program.methods
         .setConfig(cfgArgs({ minBurnBps: 0, minRewardsBps: 0 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   let stdPass: PublicKey;
   let vipPass: PublicKey;

   it("redeems the Standard pass: burns 80%, routes 20%, mints a Core asset, writes a receipt", async () => {
      await buyExactOut(buyer, new BN(1_200 * TOKEN));
      const supplyBefore = (await getMint(conn, mint)).supply;
      const rewardsBefore = (await getAccount(conn, rewardsVault)).amount;
      const { asset, receipt, perk } = await redeem(buyer, PASS_STD);
      stdPass = asset;
      const r = await program.account.receipt.fetch(receipt);
      expect(r.buyer.toBase58()).to.eq(buyer.publicKey.toBase58());
      expect(r.paid.toNumber()).to.eq(1_200 * TOKEN);
      expect(r.burned.toNumber()).to.eq(960 * TOKEN);
      expect(r.toRewards.toNumber()).to.eq(240 * TOKEN);
      expect(r.toArtist.toNumber()).to.eq(0);
      expect(r.edition).to.eq(1);
      expect(r.discountBps).to.eq(0);
      const supplyAfter = (await getMint(conn, mint)).supply;
      expect((supplyBefore - supplyAfter).toString()).to.eq((960 * TOKEN).toString());
      expect(((await getAccount(conn, rewardsVault)).amount - rewardsBefore).toString()).to.eq((240 * TOKEN).toString());
      const a = await fetchAsset(umi, umiPk(asset.toBase58()));
      expect(a.owner.toString()).to.eq(buyer.publicKey.toBase58());
      expect(a.name).to.eq("MoOG Pass Standard #1");
      expect(a.updateAuthority.type).to.eq("Collection");
      expect((a.updateAuthority as any).address.toString()).to.eq(collectionPda(perk).toBase58());
      expect(a.edition?.number).to.eq(1);
      const tier = a.attributes?.attributeList.find((x) => x.key === "tier");
      expect(tier?.value).to.eq("Standard");
      const p = await program.account.perk.fetch(perk);
      expect(p.sold).to.eq(1);
   });

   it("lets a sponsor pay rent and fees for a buyer with no SOL (payer != buyer)", async () => {
      const fan = Keypair.generate(); // 0 SOL, ever
      // give the fan 1,200 $MOST from the buyer (sponsor creates the ATA)
      const { createAssociatedTokenAccountInstruction, createTransferInstruction } = await import("@solana/spl-token");
      const tx = new anchor.web3.Transaction().add(
         createAssociatedTokenAccountInstruction(buyer.publicKey, ata(fan.publicKey), fan.publicKey, mint),
         createTransferInstruction(ata(buyer.publicKey), ata(fan.publicKey), buyer.publicKey, 1_200 * TOKEN),
      );
      await buyExactOut(buyer, new BN(1_200 * TOKEN));
      await provider.sendAndConfirm(tx, [buyer]);
      const perk = perkPda(PASS_STD);
      const nonce = nextNonce();
      const asset = assetPda(perk, nonce);
      const sponsorBefore = await conn.getBalance(other.publicKey);
      await program.methods
         .redeemPerk(nonce, new BN(1_200 * TOKEN))
         .accountsPartial({
            payer: other.publicKey,
            buyer: fan.publicKey,
            config,
            artist,
            perk,
            curve,
            mint,
            buyerAta: ata(fan.publicKey),
            rewardsVault,
            artistVault,
            collection: collectionPda(perk),
            asset,
            receipt: receiptPda(asset),
            passAsset: null,
            passPerk: null,
            mplCoreProgram: MPL_CORE,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .preInstructions([anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 })])
         .signers([other, fan])
         .rpc();
      expect(await conn.getBalance(fan.publicKey)).to.eq(0);
      expect(await conn.getBalance(other.publicKey)).to.be.lessThan(sponsorBefore);
      const a = await fetchAsset(umi, umiPk(asset.toBase58()));
      expect(a.owner.toString()).to.eq(fan.publicKey.toBase58());
   });

   it("rejects a redeem above the buyer's max_paid (front-running guard)", async () => {
      await expectError(redeem(buyer, MUSIC, undefined, new BN(1)), "SlippageExceeded");
   });

   it("applies the pass discount on an eligible perk", async () => {
      const before = (await getAccount(conn, ata(buyer.publicKey))).amount;
      const { receipt } = await redeem(buyer, MUSIC, { asset: stdPass, perkIndex: PASS_STD });
      const after = (await getAccount(conn, ata(buyer.publicKey))).amount;
      const r = await program.account.receipt.fetch(receipt);
      expect(r.discountBps).to.eq(500);
      expect(r.paid.toNumber()).to.eq(47.5 * TOKEN);
      expect(r.passUsed.toBase58()).to.eq(stdPass.toBase58());
      expect((before - after).toString()).to.eq((47.5 * TOKEN).toString());
   });

   it("rejects a pass owned by someone else and mismatched pass accounts", async () => {
      await buyExactOut(other, new BN(100 * TOKEN));
      const perk = perkPda(MUSIC);
      const nonce = nextNonce();
      const asset = assetPda(perk, nonce);
      const base = {
         payer: other.publicKey,
         buyer: other.publicKey,
         config,
         artist,
         perk,
         curve,
         mint,
         buyerAta: ata(other.publicKey),
         rewardsVault,
         artistVault,
         collection: collectionPda(perk),
         asset,
         receipt: receiptPda(asset),
         mplCoreProgram: MPL_CORE,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      };
      await expectError(
         program.methods
            .redeemPerk(nonce, new BN(1_000_000_000))
            .accountsPartial({ ...base, passAsset: stdPass, passPerk: perkPda(PASS_STD) })
            .signers([other])
            .rpc(),
         "InvalidPass",
      );
      await expectError(
         program.methods
            .redeemPerk(nonce, new BN(1_000_000_000))
            .accountsPartial({ ...base, passAsset: stdPass, passPerk: perkPda(MUSIC) })
            .signers([other])
            .rpc(),
         "PassMismatch",
      );
      await expectError(
         program.methods
            .redeemPerk(nonce, new BN(1_000_000_000))
            .accountsPartial({ ...base, passAsset: stdPass, passPerk: null })
            .signers([other])
            .rpc(),
         "PassMismatch",
      );
   });

   it("enforces early access: VIP gets in 72h before, Standard and public do not", async () => {
      await expectError(redeem(buyer, EVENT), "SaleNotStarted");
      await expectError(redeem(buyer, EVENT, { asset: stdPass, perkIndex: PASS_STD }), "SaleNotStarted");
      await buyExactOut(buyer, new BN(5_000 * TOKEN));
      const { asset } = await redeem(buyer, PASS_VIP);
      vipPass = asset;
      const { receipt } = await redeem(buyer, EVENT, { asset: vipPass, perkIndex: PASS_VIP });
      const r = await program.account.receipt.fetch(receipt);
      expect(r.discountBps).to.eq(0); // events are not discount-eligible
      expect(r.paid.toNumber()).to.eq(900 * TOKEN);
   });

   it("enforces VIP-only perks", async () => {
      await expectError(redeem(buyer, VIP_ONLY), "VipOnly");
      await expectError(redeem(buyer, VIP_ONLY, { asset: stdPass, perkIndex: PASS_STD }), "VipOnly");
      await redeem(buyer, VIP_ONLY, { asset: vipPass, perkIndex: PASS_VIP });
   });

   it("numbers limited merch and sells out", async () => {
      await buyExactOut(buyer, new BN(3_000 * TOKEN));
      const { receipt } = await redeem(buyer, MERCH, { asset: vipPass, perkIndex: PASS_VIP });
      const r = await program.account.receipt.fetch(receipt);
      expect(r.discountBps).to.eq(1500);
      expect(r.paid.toNumber()).to.eq(1_275 * TOKEN);
      expect(r.toArtist.toNumber()).to.eq(127.5 * TOKEN); // 10% artist share on this perk
      expect(r.edition).to.eq(1);
      await expectError(redeem(buyer, MERCH), "PerkSoldOut");
      const a = await program.account.artist.fetch(artist);
      expect(a.revenueTokens.toNumber()).to.eq(127.5 * TOKEN);
   });

   it("lets the artist withdraw its vault and fulfill receipts", async () => {
      const dest = getAssociatedTokenAddressSync(mint, artistAuthority.publicKey);
      await buyExactOut(artistAuthority, new BN(1 * TOKEN)); // creates the artist authority ATA
      await program.methods
         .withdrawArtistVault(new BN(100 * TOKEN))
         .accountsPartial({ authority: artistAuthority.publicKey, artist, mint, artistVault, destination: dest, tokenProgram: TOKEN_PROGRAM_ID })
         .signers([artistAuthority])
         .rpc();
      expect(Number((await getAccount(conn, dest)).amount)).to.be.greaterThanOrEqual(100 * TOKEN);
      // the protocol admin cannot drain artist vaults
      await expectError(
         program.methods
            .withdrawArtistVault(new BN(1))
            .accountsPartial({ authority: admin.publicKey, artist, mint, artistVault, destination: dest, tokenProgram: TOKEN_PROGRAM_ID })
            .rpc(),
         "Unauthorized",
      );
      // fulfillment
      const receipts = await program.account.receipt.all([{ memcmp: { offset: 10, bytes: buyer.publicKey.toBase58() } }]);
      expect(receipts.length).to.be.greaterThanOrEqual(5);
      const merch = receipts.find((r) => r.account.perk.equals(perkPda(MERCH)))!;
      await expectError(
         program.methods.fulfillReceipt().accountsPartial({ signer: other.publicKey, config, artist, receipt: merch.publicKey }).signers([other]).rpc(),
         "Unauthorized",
      );
      await program.methods.fulfillReceipt().accountsPartial({ signer: artistAuthority.publicKey, config, artist, receipt: merch.publicKey }).signers([artistAuthority]).rpc();
      await expectError(
         program.methods
            .fulfillReceipt()
            .accountsPartial({ signer: artistAuthority.publicKey, config, artist, receipt: merch.publicKey })
            .preInstructions([uniq()])
            .signers([artistAuthority])
            .rpc(),
         "AlreadyFulfilled",
      );
      expect((await program.account.receipt.fetch(merch.publicKey)).fulfilled).to.be.true;
   });

   it("gates curve buys behind KYC when enabled", async () => {
      await program.methods
         .setConfig(cfgArgs({ kycRequired: true }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      await expectError(program.methods.buyTokensSol(new BN(1_000_000), new BN(0)).accountsPartial(buyAccounts(other.publicKey)).signers([other]).rpc(), "KycRequired");
      await program.methods
         .setKyc(other.publicKey, true, Array.from(Buffer.from("GB")))
         .accountsPartial({ admin: admin.publicKey, config, kyc: kycPda(other.publicKey), systemProgram: SystemProgram.programId })
         .rpc();
      await program.methods
         .buyTokensSol(new BN(1_000_000), new BN(0))
         .accountsPartial({ ...buyAccounts(other.publicKey), kyc: kycPda(other.publicKey) })
         .preInstructions([uniq()])
         .signers([other])
         .rpc();
      // selling is an off-ramp: gated too
      await expectError(
         program.methods
            .sellTokens(new BN(1), new BN(0))
            .accountsPartial({
               seller: buyer.publicKey,
               config,
               curve,
               mint,
               solVault,
               treasury,
               sellerAta: ata(buyer.publicKey),
               kyc: null,
               tokenProgram: TOKEN_PROGRAM_ID,
               systemProgram: SystemProgram.programId,
            })
            .signers([buyer])
            .rpc(),
         "KycRequired",
      );
      // a kyc record for a different wallet does not count
      await expectError(
         program.methods
            .buyTokensSol(new BN(1_000_000), new BN(0))
            .accountsPartial({ ...buyAccounts(buyer.publicKey), kyc: kycPda(other.publicKey) })
            .signers([buyer])
            .rpc(),
         "KycRequired",
      );
      await program.methods
         .setConfig(cfgArgs({ kycRequired: false }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   it("pauses and resumes", async () => {
      await program.methods
         .setConfig(cfgArgs({ paused: true }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      await expectError(program.methods.buyTokensSol(new BN(1_000_000), new BN(0)).accountsPartial(buyAccounts(buyer.publicKey)).signers([buyer]).rpc(), "Paused");
      await expectError(redeem(buyer, MUSIC), "Paused");
      await program.methods
         .setConfig(cfgArgs({ paused: false }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   it("transfers admin only after the cool-off", async () => {
      await program.methods.proposeAdmin(other.publicKey).accountsPartial({ admin: admin.publicKey, config }).rpc();
      await expectError(program.methods.acceptAdmin().accountsPartial({ pendingAdmin: other.publicKey, config }).signers([other]).rpc(), "AdminTransferNotReady");
      await new Promise((r) => setTimeout(r, 3_000));
      await program.methods.acceptAdmin().accountsPartial({ pendingAdmin: other.publicKey, config }).signers([other]).rpc();
      expect((await program.account.config.fetch(config)).admin.toBase58()).to.eq(other.publicKey.toBase58());
      // hand it back
      await program.methods.proposeAdmin(admin.publicKey).accountsPartial({ admin: other.publicKey, config }).signers([other]).rpc();
      await new Promise((r) => setTimeout(r, 3_000));
      await program.methods.acceptAdmin().accountsPartial({ pendingAdmin: admin.publicKey, config }).rpc();
      // has_one(pending_admin) fails first once the slot is cleared
      await expectError(program.methods.acceptAdmin().accountsPartial({ pendingAdmin: admin.publicKey, config }).preInstructions([uniq()]).rpc(), "Unauthorized");
   });

   it("withdraws treasury SOL and USDC as admin only", async () => {
      const tre = await conn.getBalance(treasury);
      expect(tre).to.be.greaterThan(0);
      await expectError(
         program.methods
            .withdrawTreasurySol(new BN(1))
            .accountsPartial({ admin: other.publicKey, config, treasury, destination: other.publicKey, systemProgram: SystemProgram.programId })
            .signers([other])
            .rpc(),
         "Unauthorized",
      );
      const floor = await conn.getMinimumBalanceForRentExemption(0);
      await expectError(
         program.methods
            .withdrawTreasurySol(new BN(tre))
            .accountsPartial({ admin: admin.publicKey, config, treasury, destination: other.publicKey, systemProgram: SystemProgram.programId })
            .rpc(),
         "InsufficientReserves",
      );
      const before = await conn.getBalance(other.publicKey);
      await program.methods
         .withdrawTreasurySol(new BN(tre - floor))
         .accountsPartial({ admin: admin.publicKey, config, treasury, destination: other.publicKey, systemProgram: SystemProgram.programId })
         .rpc();
      expect(await conn.getBalance(other.publicKey)).to.eq(before + tre - floor);
      expect(await conn.getBalance(treasury)).to.eq(floor);
      const usdcAmount = (await getAccount(conn, treasuryUsdc)).amount;
      const dest = getAssociatedTokenAddressSync(USDC_DEVNET, buyer.publicKey);
      await program.methods
         .withdrawTreasuryUsdc(new BN(usdcAmount.toString()))
         .accountsPartial({ admin: admin.publicKey, config, usdcMint: USDC_DEVNET, treasuryUsdc, destination: dest, usdcTokenProgram: TOKEN_PROGRAM_ID })
         .rpc();
      expect((await getAccount(conn, treasuryUsdc)).amount.toString()).to.eq("0");
   });

   it("lists top holders from the RPC without a backend", async () => {
      let holders: { owner: string; amount: number }[] = [];
      try {
         const largest = await conn.getTokenLargestAccounts(mint);
         const owners = await conn.getMultipleParsedAccounts(largest.value.map((x) => x.address));
         holders = owners.value.map((a, i) => ({ owner: (a?.data as any).parsed.info.owner as string, amount: largest.value[i].uiAmount ?? 0 }));
      } catch (e) {
         // surfpool implements neither getTokenLargestAccounts nor getProgramAccounts for the token program;
         // read the known holders directly so the suite still checks the data path.
         const accounts = await conn.getMultipleParsedAccounts([ata(buyer.publicKey), ata(other.publicKey), rewardsVault, artistVault]);
         holders = accounts.value
            .filter(Boolean)
            .map((a) => ({ owner: (a!.data as any).parsed.info.owner as string, amount: (a!.data as any).parsed.info.tokenAmount.uiAmount ?? 0 }));
      }
      holders = holders.filter((h) => h.owner !== curve.toBase58() && h.owner !== artist.toBase58()).sort((a, b) => b.amount - a.amount);
      expect(holders.map((h) => h.owner)).to.include(buyer.publicKey.toBase58());
   });

   it("reports sane curve stats", async () => {
      const c = await program.account.curve.fetch(curve);
      expect(c.totalBurned.toNumber()).to.be.greaterThan(0);
      expect(c.rewardsAccrued.toNumber()).to.be.greaterThan(0);
      expect(c.complete).to.be.false;
      const supply = (await getMint(conn, mint)).supply;
      // tokens_sold == live supply + everything burned on redeem
      expect(c.tokensSold.toString()).to.eq((supply + BigInt(c.totalBurned.toString())).toString());
   });
});
