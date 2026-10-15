import * as anchor from "@coral-xyz/anchor";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createAssociatedTokenAccountInstruction, getAccount, getAssociatedTokenAddressSync, getMint } from "@solana/spl-token";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { fetchAsset, fetchCollection, mplCore } from "@metaplex-foundation/mpl-core";
import { publicKey as umiPk } from "@metaplex-foundation/umi";
import { assert, expect } from "chai";
import { Mostro } from "../shared/types/mostro";
import idl from "../shared/idl/mostro.json";

// ---------- constants (mirror state.rs) ----------
const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const USDC_DEVNET = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const PYTH_SOL_USD = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");
const PYTH_FEED = Buffer.from("ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d", "hex");
const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const TOKEN_METADATA = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

const TOKEN = new BN(1_000_000); // 6 decimals
const tokens = (n: number) => TOKEN.mul(new BN(n));
const TOTAL_SUPPLY = tokens(1_000_000_000);
const CURVE_ALLOCATION = tokens(280_000_000);
const DEX_ALLOCATION = tokens(70_000_000);
const MOSTRO_ALLOCATION = tokens(150_000_000);
const ARTIST_ALLOCATION = tokens(500_000_000);
const VQ0 = new BN(30_000_000_000);
const VT0 = tokens(379_000_000);
const FEE_BPS = 100;
const LAUNCH_COOLDOWN_SECS = 4;
const PROPOSAL_TTL_SECS = 60;

const ROLE_NONE = 0,
   ROLE_ADMIN = 1,
   ROLE_SUPER_ADMIN = 2;
const PROPOSAL_VAULT_TRANSFER = 0,
   PROPOSAL_SET_MEMBER = 1;
const VAULT_ARTIST_RESERVE = 0,
   VAULT_MOSTRO_RESERVE = 1,
   VAULT_SOL = 6,
   VAULT_TREASURY_SOL = 7;

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
function splitRedeem(amount: BN) {
   const burn = amount.muln(8_000).div(BPS);
   return { burn, rewards: amount.sub(burn) };
}

// ---------- helpers ----------
const u32le = (n: number) => {
   const b = Buffer.alloc(4);
   b.writeUInt32LE(n);
   return b;
};
const u64le = (n: BN) => n.toArrayLike(Buffer, "le", 8);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
   buysPaused: null,
   redeemsPaused: null,
   priceMode: null,
   solUsdPriceE6: null,
   pythSolUsdAccount: null,
   pythFeedId: null,
   maxPriceAgeSecs: null,
   adminPriceMaxAgeSecs: null,
   feeBps: null,
   launchCooldownSecs: null,
   maxSpendPerPeriodLamports: null,
   proposalTtlSecs: null,
   ...partial,
});

const proposalArgs = (partial: Record<string, unknown>) => ({
   kind: PROPOSAL_VAULT_TRANSFER,
   curve: PublicKey.default,
   vault: 0,
   destination: PublicKey.default,
   amount: new BN(0),
   wallet: PublicKey.default,
   role: ROLE_NONE,
   ...partial,
});

// Makes an otherwise identical transaction unique (avoids "already processed").
const uniq = () => anchor.web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 + Math.floor(Math.random() * 1_000_000) });
const cu = (units: number) => anchor.web3.ComputeBudgetProgram.setComputeUnitLimit({ units });

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
   const pid = program.programId;
   const conn = provider.connection;
   const admin = (provider.wallet as anchor.Wallet).payer;
   const buyer = Keypair.generate();
   const other = Keypair.generate();
   const artistAuthority = Keypair.generate();
   const member1 = Keypair.generate(); // becomes an admin (weight 1)
   const member2 = Keypair.generate(); // becomes a super-admin (weight 2)
   const umi = createUmi(conn.rpcEndpoint).use(mplCore());

   // ---- PDAs ----
   const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, pid)[0];
   const config = pda([Buffer.from("config")]);
   const treasury = pda([Buffer.from("treasury")]);
   const [programData] = PublicKey.findProgramAddressSync([pid.toBuffer()], BPF_UPGRADEABLE);
   const treasuryUsdc = getAssociatedTokenAddressSync(USDC_DEVNET, config, true);
   const artistPda = (i: number) => pda([Buffer.from("artist"), u32le(i)]);
   const artist = artistPda(0);
   const memberPda = (w: PublicKey) => pda([Buffer.from("member"), w.toBuffer()]);
   const blacklistPda = (w: PublicKey) => pda([Buffer.from("blacklist"), w.toBuffer()]);
   const proposalPda = (i: number) => pda([Buffer.from("proposal"), u64le(new BN(i))]);
   const approvalPda = (proposal: PublicKey, w: PublicKey) => pda([Buffer.from("approval"), proposal.toBuffer(), w.toBuffer()]);
   const spendPda = (curve: PublicKey, w: PublicKey) => pda([Buffer.from("spend"), curve.toBuffer(), w.toBuffer()]);
   function curveAddrs(index: number) {
      const curve = pda([Buffer.from("curve"), u32le(index)]);
      const mint = pda([Buffer.from("mint"), u32le(index)]);
      return {
         curve,
         mint,
         curveVault: pda([Buffer.from("curve_vault"), curve.toBuffer()]),
         artistReserve: pda([Buffer.from("artist_reserve"), curve.toBuffer()]),
         mostroReserve: pda([Buffer.from("mostro_reserve"), curve.toBuffer()]),
         dexReserve: pda([Buffer.from("dex_reserve"), curve.toBuffer()]),
         rewardsVault: pda([Buffer.from("rewards"), curve.toBuffer()]),
         solVault: pda([Buffer.from("sol_vault"), curve.toBuffer()]),
         usdcVault: getAssociatedTokenAddressSync(USDC_DEVNET, curve, true),
         metadata: PublicKey.findProgramAddressSync([Buffer.from("metadata"), TOKEN_METADATA.toBuffer(), mint.toBuffer()], TOKEN_METADATA)[0],
      };
   }
   const C = curveAddrs(0);
   const { curve, mint, curveVault, artistReserve, mostroReserve, dexReserve, rewardsVault, solVault, usdcVault } = C;
   const perkPda = (i: number) => pda([Buffer.from("perk"), artist.toBuffer(), u32le(i)]);
   const COLLECTION_SALT = new BN(1);
   const collectionPda = (perk: PublicKey, salt: BN = COLLECTION_SALT) => pda([Buffer.from("collection"), perk.toBuffer(), u64le(salt)]);
   const assetPda = (perk: PublicKey, nonce: BN) => pda([Buffer.from("asset"), perk.toBuffer(), u64le(nonce)]);
   const receiptPda = (asset: PublicKey) => pda([Buffer.from("receipt"), asset.toBuffer()]);
   const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(mint, owner);

   // perk indexes created in "creates perks"
   const PASS_CLASSIC = 0,
      PASS_VIP = 1,
      MUSIC = 2,
      EVENT = 3,
      MERCH = 4,
      DROP = 5; // hybrid, priced in SOL
   const DROP_PRICE = new BN(0.2 * LAMPORTS_PER_SOL);
   let nonceCounter = new BN(Date.now());
   const nextNonce = () => (nonceCounter = nonceCounter.addn(1));

   const buyAccounts = (who: PublicKey, payer: PublicKey = who) => ({
      payer,
      buyer: who,
      config,
      curve,
      mint,
      curveVault,
      solVault,
      treasury,
      buyerAta: ata(who),
      spend: spendPda(curve, who),
      blacklistEntry: blacklistPda(who),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
   });

   const usdcBuyAccounts = (who: PublicKey, priceUpdate: PublicKey = PYTH_SOL_USD) => ({
      payer: who,
      buyer: who,
      config,
      curve,
      mint,
      curveVault,
      usdcMint: USDC_DEVNET,
      buyerUsdc: getAssociatedTokenAddressSync(USDC_DEVNET, who),
      usdcVault,
      treasuryUsdc,
      buyerAta: ata(who),
      spend: spendPda(curve, who),
      blacklistEntry: blacklistPda(who),
      priceUpdate,
      tokenProgram: TOKEN_PROGRAM_ID,
      usdcTokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
   });

   async function buySol(who: Keypair, lamports: BN, minOut = new BN(0)) {
      return program.methods.buyTokensSol(lamports, minOut).accountsPartial(buyAccounts(who.publicKey)).preInstructions([uniq()]).signers([who]).rpc();
   }

   async function buyExactOut(who: Keypair, want: BN) {
      const c = await program.account.curve.fetch(curve);
      const q = quoteBuyExactOut(c.virtualSolReserves, c.virtualTokenReserves, want, FEE_BPS);
      await program.methods
         .buyTokensExactOutSol(want, q.cost.add(q.fee).muln(101).divn(100))
         .accountsPartial(buyAccounts(who.publicKey))
         .preInstructions([uniq()])
         .signers([who])
         .rpc();
   }

   /** `redeem_perk` (token-priced). */
   async function redeem(who: Keypair, perkIndex: number, maxPaid?: BN, payer: Keypair = who) {
      const perk = perkPda(perkIndex);
      const nonce = nextNonce();
      const cap = maxPaid ?? (await program.account.perk.fetch(perk)).priceTokens;
      const asset = assetPda(perk, nonce);
      const receipt = receiptPda(asset);
      await program.methods
         .redeemPerk(nonce, cap)
         .accountsPartial({
            payer: payer.publicKey,
            buyer: who.publicKey,
            config,
            artist,
            perk,
            curve,
            mint,
            buyerAta: ata(who.publicKey),
            rewardsVault,
            collection: collectionPda(perk),
            asset,
            receipt,
            blacklistEntry: blacklistPda(who.publicKey),
            mplCoreProgram: MPL_CORE,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .preInstructions([cu(300_000)])
         .signers(payer.publicKey.equals(who.publicKey) ? [who] : [payer, who])
         .rpc();
      return { perk, asset, receipt, nonce };
   }

   /** `buy_perk_sol` (hybrid, SOL-priced). */
   async function buyPerk(who: Keypair, perkIndex: number, maxLamports?: BN) {
      const perk = perkPda(perkIndex);
      const nonce = nextNonce();
      const cap = maxLamports ?? (await program.account.perk.fetch(perk)).priceLamports;
      const asset = assetPda(perk, nonce);
      const receipt = receiptPda(asset);
      await program.methods
         .buyPerkSol(nonce, cap)
         .accountsPartial({
            payer: who.publicKey,
            buyer: who.publicKey,
            config,
            artist,
            artistAuthority: artistAuthority.publicKey,
            perk,
            curve,
            mint,
            curveVault,
            artistReserve,
            rewardsVault,
            solVault,
            treasury,
            spend: spendPda(curve, who.publicKey),
            blacklistEntry: blacklistPda(who.publicKey),
            collection: collectionPda(perk),
            asset,
            receipt,
            mplCoreProgram: MPL_CORE,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
         })
         .preInstructions([cu(400_000)])
         .signers([who])
         .rpc();
      return { perk, asset, receipt, nonce };
   }

   // ---- governance helpers ----
   const memberAccounts = (w: PublicKey) => ({ memberWallet: w, config, member: memberPda(w) });

   async function propose(by: Keypair, args: Record<string, unknown>) {
      const index = (await program.account.config.fetch(config)).proposalCount.toNumber();
      const proposal = proposalPda(index);
      await program.methods
         .createProposal(proposalArgs(args) as any)
         .accountsPartial({
            proposer: by.publicKey,
            config,
            member: memberPda(by.publicKey),
            proposal,
            approval: approvalPda(proposal, by.publicKey),
            systemProgram: SystemProgram.programId,
         })
         .signers(by.publicKey.equals(admin.publicKey) ? [] : [by])
         .rpc();
      return proposal;
   }

   async function approve(by: Keypair, proposal: PublicKey) {
      await program.methods
         .approveProposal()
         .accountsPartial({ ...memberAccounts(by.publicKey), proposal, approval: approvalPda(proposal, by.publicKey), systemProgram: SystemProgram.programId })
         .signers(by.publicKey.equals(admin.publicKey) ? [] : [by])
         .rpc();
   }

   async function executeSetMember(by: Keypair, proposal: PublicKey, wallet: PublicKey) {
      await program.methods
         .executeSetMember()
         .accountsPartial({ ...memberAccounts(by.publicKey), proposal, target: memberPda(wallet), systemProgram: SystemProgram.programId })
         .preInstructions([uniq()])
         .signers(by.publicKey.equals(admin.publicKey) ? [] : [by])
         .rpc();
   }

   async function executeTokenTransfer(by: Keypair, proposal: PublicKey, source: PublicKey, destination: PublicKey, withCurve = true) {
      await program.methods
         .executeTokenTransfer()
         .accountsPartial({ ...memberAccounts(by.publicKey), proposal, curve: withCurve ? curve : null, mint, source, destination, tokenProgram: TOKEN_PROGRAM_ID })
         .preInstructions([uniq()])
         .signers(by.publicKey.equals(admin.publicKey) ? [] : [by])
         .rpc();
   }

   async function executeSolTransfer(by: Keypair, proposal: PublicKey, source: PublicKey, destination: PublicKey, withCurve: boolean) {
      await program.methods
         .executeSolTransfer()
         .accountsPartial({ ...memberAccounts(by.publicKey), proposal, curve: withCurve ? curve : null, source, destination, systemProgram: SystemProgram.programId })
         .preInstructions([uniq()])
         .signers(by.publicKey.equals(admin.publicKey) ? [] : [by])
         .rpc();
   }

   /** Appoints `wallet` with `role` through a proposal the admin alone can pass (weight 2 of 2). */
   async function appoint(wallet: PublicKey, role: number, by: Keypair = admin) {
      const p = await propose(by, { kind: PROPOSAL_SET_MEMBER, wallet, role });
      await executeSetMember(by, p, wallet);
      return p;
   }

   // The fork mirrors devnet, where the program is already seeded. On surfpool, reset every PDA the
   // suite initializes so it always starts from a blank protocol. No-op on other validators.
   async function wipeForkState() {
      const targets: PublicKey[] = [config, treasury, treasuryUsdc, memberPda(admin.publicKey), blacklistPda(admin.publicKey)];
      for (const i of [0, 1]) {
         targets.push(artistPda(i), ...Object.values(curveAddrs(i)));
      }
      for (let i = 0; i < 8; i++) {
         const perk = perkPda(i);
         targets.push(perk, collectionPda(perk));
      }
      for (let i = 0; i < 16; i++) {
         const p = proposalPda(i);
         targets.push(p, approvalPda(p, admin.publicKey));
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
      for (const k of [buyer, other, artistAuthority, member1, member2]) {
         const sig = await conn.requestAirdrop(k.publicKey, 20 * LAMPORTS_PER_SOL);
         await conn.confirmTransaction(sig, "confirmed");
      }
   });

   // ================================================================================================
   // config + governance bootstrap
   // ================================================================================================

   it("initializes config and seats the admin as founding super-admin", async () => {
      await program.methods
         .initializeConfig({
            admin: admin.publicKey,
            feeBps: FEE_BPS,
            solUsdPriceE6: new BN(112_000_000),
            maxPriceAgeSecs: 300,
            pythSolUsdAccount: PYTH_SOL_USD,
            pythFeedId: Array.from(PYTH_FEED),
            adminCooloffSecs: 2,
            adminPriceMaxAgeSecs: 86_400,
            launchCooldownSecs: LAUNCH_COOLDOWN_SECS,
            maxSpendPerPeriodLamports: new BN(0),
            proposalTtlSecs: PROPOSAL_TTL_SECS,
         })
         .accountsPartial({
            payer: admin.publicKey,
            config,
            treasury,
            usdcMint: USDC_DEVNET,
            treasuryUsdc,
            adminMember: memberPda(admin.publicKey),
            program: pid,
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
      expect(c.buysPaused).to.be.false;
      expect(c.redeemsPaused).to.be.false;
      expect(c.launchCooldownSecs).to.eq(LAUNCH_COOLDOWN_SECS);
      expect(c.totalWeight).to.eq(2);
      expect(c.memberCount).to.eq(1);
      const m = await program.account.member.fetch(memberPda(admin.publicKey));
      expect(m.role).to.eq(ROLE_SUPER_ADMIN);
      expect(m.wallet.toBase58()).to.eq(admin.publicKey.toBase58());
   });

   it("rejects config changes from a non-admin", async () => {
      await expectError(
         program.methods
            .setConfig(cfgArgs({ buysPaused: true }) as any)
            .accountsPartial({ admin: other.publicKey, config })
            .signers([other])
            .rpc(),
         "Unauthorized",
      );
      await expectError(
         program.methods
            .setConfig(cfgArgs({ adminPriceMaxAgeSecs: 0 }) as any)
            .accountsPartial({ admin: admin.publicKey, config })
            .rpc(),
         "InvalidAmount",
      );
   });

   it("has no sell instruction and no single-key treasury withdrawal", async () => {
      const names = (idl as any).instructions.map((i: any) => i.name);
      expect(names).to.not.include("sell_tokens");
      expect(names).to.not.include("withdraw_treasury_sol");
      expect(names).to.not.include("withdraw_treasury_usdc");
      expect(names).to.not.include("withdraw_artist_vault");
      expect(names).to.not.include("set_kyc");
   });

   // ================================================================================================
   // artist + token
   // ================================================================================================

   it("creates an artist (admin only)", async () => {
      await expectError(
         program.methods
            .createArtist(artistAuthority.publicKey, "MoOG", "u")
            .accountsPartial({ admin: other.publicKey, config, artist, systemProgram: SystemProgram.programId })
            .signers([other])
            .rpc(),
         "Unauthorized",
      );
      await program.methods
         .createArtist(artistAuthority.publicKey, "MoOG", "https://mostro.xyz/artists/moog.json")
         .accountsPartial({ admin: admin.publicKey, config, artist, systemProgram: SystemProgram.programId })
         .rpc();
      const a = await program.account.artist.fetch(artist);
      expect(a.authority.toBase58()).to.eq(artistAuthority.publicKey.toBase58());
      expect(a.curve.toBase58()).to.eq(PublicKey.default.toBase58());
      expect(a.revenueLamports.toNumber()).to.eq(0);
   });

   const createCurveAccounts = (index: number, artistKey: PublicKey) => {
      const a = curveAddrs(index);
      return {
         admin: admin.publicKey,
         config,
         artist: artistKey,
         curve: a.curve,
         mint: a.mint,
         curveVault: a.curveVault,
         artistReserve: a.artistReserve,
         mostroReserve: a.mostroReserve,
         dexReserve: a.dexReserve,
         rewardsVault: a.rewardsVault,
         solVault: a.solVault,
         usdcMint: USDC_DEVNET,
         usdcVault: a.usdcVault,
         metadata: a.metadata,
         tokenProgram: TOKEN_PROGRAM_ID,
         usdcTokenProgram: TOKEN_PROGRAM_ID,
         associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
         tokenMetadataProgram: TOKEN_METADATA,
         systemProgram: SystemProgram.programId,
         rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      };
   };

   it("creates the artist token: 1B fixed supply split 28/7/15/50, metadata attached, mint authority revoked", async () => {
      const args = { name: "MoOG Token", symbol: "MOOG", uri: "https://mostro.xyz/moog.json", virtualSolReserves: VQ0, virtualTokenReserves: VT0, saleStartTs: new BN(0) };
      // virtual token reserves must exceed the curve allocation
      await expectError(
         program.methods
            .createCurve({ ...args, virtualTokenReserves: CURVE_ALLOCATION })
            .accountsPartial(createCurveAccounts(0, artist))
            .preInstructions([cu(400_000)])
            .rpc(),
         "InvalidCurveParams",
      );
      const before = Math.floor(Date.now() / 1000);
      await program.methods
         .createCurve(args)
         .accountsPartial(createCurveAccounts(0, artist))
         .preInstructions([cu(400_000)])
         .rpc();

      const c = await program.account.curve.fetch(curve);
      expect(c.artist.toBase58()).to.eq(artist.toBase58());
      expect(c.mint.toBase58()).to.eq(mint.toBase58());
      expect(c.supplyCap.eq(CURVE_ALLOCATION)).to.be.true;
      expect(c.tokensSold.toNumber()).to.eq(0);
      expect(c.saleStartTs.toNumber()).to.be.greaterThanOrEqual(before + LAUNCH_COOLDOWN_SECS - 1);
      const m = await getMint(conn, mint);
      expect(m.decimals).to.eq(6);
      expect(m.supply.toString()).to.eq(TOTAL_SUPPLY.toString());
      expect(m.mintAuthority).to.be.null;
      expect((await getAccount(conn, curveVault)).amount.toString()).to.eq(CURVE_ALLOCATION.toString());
      expect((await getAccount(conn, artistReserve)).amount.toString()).to.eq(ARTIST_ALLOCATION.toString());
      expect((await getAccount(conn, mostroReserve)).amount.toString()).to.eq(MOSTRO_ALLOCATION.toString());
      expect((await getAccount(conn, dexReserve)).amount.toString()).to.eq(DEX_ALLOCATION.toString());
      expect((await getAccount(conn, rewardsVault)).amount.toString()).to.eq("0");
      expect(await conn.getBalance(solVault)).to.be.greaterThan(0);
      const info = await conn.getAccountInfo(C.metadata);
      assert(info, "metadata account must exist");
      expect(info.owner.toBase58()).to.eq(TOKEN_METADATA.toBase58());
      expect(info.data.toString("utf8")).to.include("MOOG");
      expect((await program.account.artist.fetch(artist)).curve.toBase58()).to.eq(curve.toBase58());
      // one token per artist
      await expectError(
         program.methods
            .createCurve(args)
            .accountsPartial(createCurveAccounts(1, artist))
            .preInstructions([cu(400_000)])
            .rpc(),
         "ArtistHasCurve",
      );
   });

   it("keeps the curve closed during the launch cool-down", async () => {
      await expectError(buySol(buyer, new BN(0.1 * LAMPORTS_PER_SOL)), "SaleNotStarted");
      const c = await program.account.curve.fetch(curve);
      const wait = c.saleStartTs.toNumber() * 1000 - Date.now() + 1_500;
      if (wait > 0) await sleep(wait);
   });

   // ================================================================================================
   // buys
   // ================================================================================================

   it("buys tokens with SOL at the quoted amount, served from the curve vault", async () => {
      const lamportsIn = new BN(0.1 * LAMPORTS_PER_SOL);
      const before = await program.account.curve.fetch(curve);
      const q = quoteBuyExactIn(before.virtualSolReserves, before.virtualTokenReserves, lamportsIn, FEE_BPS);
      const treasuryBefore = await conn.getBalance(treasury);
      const vaultBefore = await conn.getBalance(solVault);
      const curveVaultBefore = (await getAccount(conn, curveVault)).amount;
      await buySol(buyer, lamportsIn, q.out);
      const acc = await getAccount(conn, ata(buyer.publicKey));
      expect(acc.amount.toString()).to.eq(q.out.toString());
      expect(await conn.getBalance(treasury)).to.eq(treasuryBefore + q.fee.toNumber());
      expect(await conn.getBalance(solVault)).to.eq(vaultBefore + q.net.toNumber());
      expect((curveVaultBefore - (await getAccount(conn, curveVault)).amount).toString()).to.eq(q.out.toString());
      const after = await program.account.curve.fetch(curve);
      expect(after.tokensSold.eq(q.out)).to.be.true;
      expect(after.realSolReserves.eq(q.net)).to.be.true;
      // ~1.246M tokens at genesis
      expect(q.out.div(TOKEN).toNumber()).to.be.within(1_246_000, 1_247_000);
      // supply is unchanged: buys move tokens, they do not mint
      expect((await getMint(conn, mint)).supply.toString()).to.eq(TOTAL_SUPPLY.toString());
      const s = await program.account.spendTracker.fetch(spendPda(curve, buyer.publicKey));
      expect(s.spentLamports.eq(lamportsIn)).to.be.true;
   });

   it("enforces slippage and buys an exact number of tokens", async () => {
      await expectError(buySol(buyer, new BN(LAMPORTS_PER_SOL), tokens(10_000_000_000)), "SlippageExceeded");
      const want = tokens(1_000);
      const before = await getAccount(conn, ata(buyer.publicKey));
      await buyExactOut(buyer, want);
      const after = await getAccount(conn, ata(buyer.publicKey));
      expect((after.amount - before.amount).toString()).to.eq(want.toString());
   });

   it("buys with USDC through the admin SOL/USD price", async () => {
      await rpc(conn, "surfnet_setTokenAccount", [buyer.publicKey.toBase58(), USDC_DEVNET.toBase58(), { amount: 50_000_000 }]);
      const usdcIn = new BN(10_000_000); // $10
      const cfg = await program.account.config.fetch(config);
      const lamportsEquiv = usdcIn.mul(new BN(1_000_000_000)).div(cfg.solUsdPriceE6);
      const c = await program.account.curve.fetch(curve);
      const q = quoteBuyExactIn(c.virtualSolReserves, c.virtualTokenReserves, lamportsEquiv, FEE_BPS);
      const before = await getAccount(conn, ata(buyer.publicKey));
      const spentBefore = (await program.account.spendTracker.fetch(spendPda(curve, buyer.publicKey))).spentLamports;
      await program.methods.buyTokensUsdc(usdcIn, q.out).accountsPartial(usdcBuyAccounts(buyer.publicKey)).signers([buyer]).rpc();
      const after = await getAccount(conn, ata(buyer.publicKey));
      expect((after.amount - before.amount).toString()).to.eq(q.out.toString());
      const vault = await getAccount(conn, usdcVault);
      const tre = await getAccount(conn, treasuryUsdc);
      expect(Number(vault.amount) + Number(tre.amount)).to.eq(usdcIn.toNumber());
      expect(Number(tre.amount)).to.be.greaterThan(0);
      // USDC counts against the SOL cap at its SOL equivalent
      const spentAfter = (await program.account.spendTracker.fetch(spendPda(curve, buyer.publicKey))).spentLamports;
      expect(spentAfter.sub(spentBefore).eq(lamportsEquiv)).to.be.true;
   });

   it("reads the Pyth price in mode 1 (or rejects a stale feed)", async () => {
      await program.methods
         .setConfig(cfgArgs({ priceMode: 1 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      const info = await conn.getAccountInfo(PYTH_SOL_USD);
      assert(info, "pyth account must be cloned from devnet");
      const publishTime = Number(info.data.readBigInt64LE(93));
      const fresh = Math.floor(Date.now() / 1000) - publishTime <= 300;
      const tx = program.methods.buyTokensUsdc(new BN(1_000_000), new BN(0)).accountsPartial(usdcBuyAccounts(buyer.publicKey)).signers([buyer]).rpc();
      if (fresh) {
         await tx;
      } else {
         await expectError(tx, "PriceTooOld");
      }
      await expectError(
         program.methods.buyTokensUsdc(new BN(1_000_000), new BN(0)).accountsPartial(usdcBuyAccounts(buyer.publicKey, config)).signers([buyer]).rpc(),
         "InvalidPriceAccount",
      );
      await program.methods
         .setConfig(cfgArgs({ priceMode: 0 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   it("enforces the anti-whale monthly SOL cap per wallet", async () => {
      await program.methods
         .setConfig(cfgArgs({ maxSpendPerPeriodLamports: new BN(0.5 * LAMPORTS_PER_SOL) }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      await buySol(other, new BN(0.3 * LAMPORTS_PER_SOL));
      await expectError(buySol(other, new BN(0.3 * LAMPORTS_PER_SOL)), "SpendCapExceeded");
      await buySol(other, new BN(0.1 * LAMPORTS_PER_SOL)); // 0.4 <= 0.5
      // a different wallet has its own counter
      await buySol(buyer, new BN(0.3 * LAMPORTS_PER_SOL));
      await program.methods
         .setConfig(cfgArgs({ maxSpendPerPeriodLamports: new BN(0) }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   it("blocks blacklisted wallets from buying; everyone else is allowed by default", async () => {
      await expectError(
         program.methods
            .setBlacklist(other.publicKey, true)
            .accountsPartial({ admin: buyer.publicKey, config, entry: blacklistPda(other.publicKey), systemProgram: SystemProgram.programId })
            .signers([buyer])
            .rpc(),
         "Unauthorized",
      );
      await program.methods
         .setBlacklist(other.publicKey, true)
         .accountsPartial({ admin: admin.publicKey, config, entry: blacklistPda(other.publicKey), systemProgram: SystemProgram.programId })
         .rpc();
      await expectError(buySol(other, new BN(0.01 * LAMPORTS_PER_SOL)), "Blacklisted");
      // the client cannot dodge the check by passing another wallet's (empty) entry
      await expectError(
         program.methods
            .buyTokensSol(new BN(0.01 * LAMPORTS_PER_SOL), new BN(0))
            .accountsPartial({ ...buyAccounts(other.publicKey), blacklistEntry: blacklistPda(buyer.publicKey) })
            .signers([other])
            .rpc(),
         "ConstraintSeeds",
      );
      await program.methods
         .setBlacklist(other.publicKey, false)
         .accountsPartial({ admin: admin.publicKey, config, entry: blacklistPda(other.publicKey), systemProgram: SystemProgram.programId })
         .rpc();
      await buySol(other, new BN(0.01 * LAMPORTS_PER_SOL));
   });

   // ================================================================================================
   // perks
   // ================================================================================================

   const perkArgs = (p: { kind: any; tier: number; priceTokens: BN; priceLamports: BN; max: number; start: number; name: string }, i: number) => ({
      kind: p.kind,
      tier: p.tier,
      priceTokens: p.priceTokens,
      priceLamports: p.priceLamports,
      maxSupply: p.max,
      publicStartTs: new BN(p.start),
      name: p.name,
      uri: `https://mostro.xyz/perks/${i}.json`,
      collectionSalt: COLLECTION_SALT,
   });
   const createPerkAccounts = (signer: PublicKey, i: number) => ({
      signer,
      config,
      artist,
      curve,
      mint,
      perk: perkPda(i),
      collection: collectionPda(perkPda(i)),
      mplCoreProgram: MPL_CORE,
      systemProgram: SystemProgram.programId,
   });

   it("creates perks: passes (admin only), token-priced perks and a SOL-priced hybrid drop", async () => {
      const now = Math.floor(Date.now() / 1000);
      const perks = [
         { kind: { pass: {} }, tier: 0, priceTokens: tokens(100_000), priceLamports: new BN(0), max: 0, start: 0, name: "Mostro Pass Classic" },
         { kind: { pass: {} }, tier: 1, priceTokens: tokens(300_000), priceLamports: new BN(0), max: 0, start: 0, name: "Mostro Pass VIP" },
         { kind: { music: {} }, tier: 0, priceTokens: tokens(10_000), priceLamports: new BN(0), max: 0, start: 0, name: "Unreleased track" },
         { kind: { event: {} }, tier: 0, priceTokens: tokens(50_000), priceLamports: new BN(0), max: 0, start: now + 2 * 86_400, name: "Listening session" },
         { kind: { merch: {} }, tier: 0, priceTokens: tokens(20_000), priceLamports: new BN(0), max: 1, start: 0, name: "Numbered tee" },
         { kind: { music: {} }, tier: 0, priceTokens: new BN(0), priceLamports: DROP_PRICE, max: 100, start: 0, name: "Exclusive drop" },
      ];
      // an artist cannot mint itself a Mostro Pass
      await expectError(
         program.methods.createPerk(perkArgs(perks[0], 0)).accountsPartial(createPerkAccounts(artistAuthority.publicKey, 0)).signers([artistAuthority]).rpc(),
         "Unauthorized",
      );
      // a perk must be priced in tokens or in SOL, never both or neither
      await expectError(
         program.methods
            .createPerk(perkArgs({ ...perks[2], priceLamports: new BN(1) }, 0))
            .accountsPartial(createPerkAccounts(artistAuthority.publicKey, 0))
            .signers([artistAuthority])
            .rpc(),
         "InvalidPerkPrice",
      );
      await expectError(
         program.methods
            .createPerk(perkArgs({ ...perks[2], priceTokens: new BN(0) }, 0))
            .accountsPartial(createPerkAccounts(artistAuthority.publicKey, 0))
            .signers([artistAuthority])
            .rpc(),
         "InvalidPerkPrice",
      );
      for (let i = 0; i < perks.length; i++) {
         const p = perks[i];
         const creator = (p.kind as any).pass ? admin : artistAuthority;
         await program.methods
            .createPerk(perkArgs(p, i))
            .accountsPartial(createPerkAccounts(creator.publicKey, i))
            .signers(creator === admin ? [] : [creator])
            .rpc();
      }
      const a = await program.account.artist.fetch(artist);
      expect(a.perkCount).to.eq(perks.length);
      const col = await fetchCollection(umi, umiPk(collectionPda(perkPda(PASS_VIP)).toBase58()));
      expect(col.name).to.eq("Mostro Pass VIP");
      expect(col.updateAuthority.toString()).to.eq(artist.toBase58());
      const drop = await program.account.perk.fetch(perkPda(DROP));
      expect(drop.priceLamports.eq(DROP_PRICE)).to.be.true;
      expect(drop.priceTokens.toNumber()).to.eq(0);
      // a random wallet cannot create perks for this artist
      await expectError(
         program.methods.createPerk(perkArgs(perks[2], perks.length)).accountsPartial(createPerkAccounts(other.publicKey, perks.length)).signers([other]).rpc(),
         "Unauthorized",
      );
   });

   it("keeps pass perks admin-only for edits and rejects invalid price edits", async () => {
      const setPerk = (signer: Keypair, i: number, args: Record<string, unknown>) =>
         program.methods
            .setPerk({ priceTokens: null, priceLamports: null, active: null, maxSupply: null, publicStartTs: null, uri: null, ...args } as any)
            .accountsPartial({ signer: signer.publicKey, config, artist, perk: perkPda(i) })
            .signers(signer === admin ? [] : [signer])
            .rpc();
      await expectError(setPerk(artistAuthority, PASS_VIP, { priceTokens: new BN(1) }), "Unauthorized");
      await expectError(setPerk(artistAuthority, MUSIC, { priceLamports: new BN(1) }), "InvalidPerkPrice");
      // the admin cannot take over an artist by rewriting its authority
      await expectError(
         program.methods
            .setArtist({ authority: admin.publicKey, name: null, uri: null, active: null } as any)
            .accountsPartial({ signer: admin.publicKey, config, artist })
            .rpc(),
         "Unauthorized",
      );
   });

   let classicPass: PublicKey;

   it("redeems a token-priced perk: burns 80%, routes 20% to rewards, mints a Core asset, writes a receipt", async () => {
      const price = tokens(100_000);
      await buyExactOut(buyer, price);
      const supplyBefore = (await getMint(conn, mint)).supply;
      const rewardsBefore = (await getAccount(conn, rewardsVault)).amount;
      const balBefore = (await getAccount(conn, ata(buyer.publicKey))).amount;
      const { asset, receipt, perk } = await redeem(buyer, PASS_CLASSIC);
      classicPass = asset;
      const { burn, rewards } = splitRedeem(price);
      const r = await program.account.receipt.fetch(receipt);
      expect(r.buyer.toBase58()).to.eq(buyer.publicKey.toBase58());
      expect(r.paidTokens.eq(price)).to.be.true;
      expect(r.paidLamports.toNumber()).to.eq(0);
      expect(r.burned.eq(burn)).to.be.true;
      expect(r.toRewards.eq(rewards)).to.be.true;
      expect(r.tokensFromCurve.toNumber()).to.eq(0);
      expect(r.edition).to.eq(1);
      expect(r.fulfilled).to.be.false;
      expect((balBefore - (await getAccount(conn, ata(buyer.publicKey))).amount).toString()).to.eq(price.toString());
      expect((supplyBefore - (await getMint(conn, mint)).supply).toString()).to.eq(burn.toString());
      expect(((await getAccount(conn, rewardsVault)).amount - rewardsBefore).toString()).to.eq(rewards.toString());
      const a = await fetchAsset(umi, umiPk(asset.toBase58()));
      expect(a.owner.toString()).to.eq(buyer.publicKey.toBase58());
      expect(a.name).to.eq("Mostro Pass Classic #1");
      expect(a.updateAuthority.type).to.eq("Collection");
      expect((a.updateAuthority as any).address.toString()).to.eq(collectionPda(perk).toBase58());
      expect(a.edition?.number).to.eq(1);
      const attrs = Object.fromEntries((a.attributes?.attributeList ?? []).map((x) => [x.key, x.value]));
      expect(attrs.kind).to.eq("pass");
      expect(attrs.tier).to.eq("Classic");
      expect(attrs.artist).to.eq("MoOG");
      expect((await program.account.perk.fetch(perk)).sold).to.eq(1);
      const c = await program.account.curve.fetch(curve);
      expect(c.totalBurned.eq(burn)).to.be.true;
      expect(c.rewardsAccrued.eq(rewards)).to.be.true;
   });

   it("lets a sponsor pay rent and fees for a buyer with no SOL (payer != buyer)", async () => {
      const fan = Keypair.generate(); // 0 SOL, ever
      const price = tokens(10_000);
      await buyExactOut(buyer, price);
      const { createTransferInstruction } = await import("@solana/spl-token");
      const tx = new anchor.web3.Transaction().add(
         createAssociatedTokenAccountInstruction(buyer.publicKey, ata(fan.publicKey), fan.publicKey, mint),
         createTransferInstruction(ata(buyer.publicKey), ata(fan.publicKey), buyer.publicKey, BigInt(price.toString())),
      );
      await provider.sendAndConfirm(tx, [buyer]);
      const sponsorBefore = await conn.getBalance(other.publicKey);
      const { asset } = await redeem(fan, MUSIC, undefined, other);
      expect(await conn.getBalance(fan.publicKey)).to.eq(0);
      expect(await conn.getBalance(other.publicKey)).to.be.lessThan(sponsorBefore);
      expect((await fetchAsset(umi, umiPk(asset.toBase58()))).owner.toString()).to.eq(fan.publicKey.toBase58());
   });

   it("rejects a redeem above the buyer's max_paid (front-running guard)", async () => {
      await expectError(redeem(buyer, MUSIC, new BN(1)), "SlippageExceeded");
   });

   it("sells a hybrid perk for SOL: half buys on the curve, half pays the artist, all tokens burned 80/20", async () => {
      const perk = perkPda(DROP);
      const c0 = await program.account.curve.fetch(curve);
      const curveHalf = DROP_PRICE.divn(2);
      const artistHalf = DROP_PRICE.sub(curveHalf);
      const q = quoteBuyExactIn(c0.virtualSolReserves, c0.virtualTokenReserves, curveHalf, FEE_BPS);
      const { burn: burnC, rewards: rewardsC } = splitRedeem(q.out);
      const before = {
         solVault: await conn.getBalance(solVault),
         treasury: await conn.getBalance(treasury),
         artistWallet: await conn.getBalance(artistAuthority.publicKey),
         buyer: await conn.getBalance(buyer.publicKey),
         curveVault: (await getAccount(conn, curveVault)).amount,
         artistReserve: (await getAccount(conn, artistReserve)).amount,
         rewards: (await getAccount(conn, rewardsVault)).amount,
         supply: (await getMint(conn, mint)).supply,
         spent: (await program.account.spendTracker.fetch(spendPda(curve, buyer.publicKey))).spentLamports,
      };
      // price cap protects the buyer from a set_perk bump
      await expectError(buyPerk(buyer, DROP, DROP_PRICE.subn(1)), "SlippageExceeded");
      const { asset, receipt } = await buyPerk(buyer, DROP);

      expect(await conn.getBalance(solVault)).to.eq(before.solVault + q.net.toNumber());
      expect(await conn.getBalance(treasury)).to.eq(before.treasury + q.fee.toNumber());
      expect(await conn.getBalance(artistAuthority.publicKey)).to.eq(before.artistWallet + artistHalf.toNumber());
      expect((before.curveVault - (await getAccount(conn, curveVault)).amount).toString()).to.eq(q.out.toString());
      expect((before.artistReserve - (await getAccount(conn, artistReserve)).amount).toString()).to.eq(q.out.toString());
      expect(((await getAccount(conn, rewardsVault)).amount - before.rewards).toString()).to.eq(rewardsC.muln(2).toString());
      expect((before.supply - (await getMint(conn, mint)).supply).toString()).to.eq(burnC.muln(2).toString());

      const r = await program.account.receipt.fetch(receipt);
      expect(r.paidLamports.eq(DROP_PRICE)).to.be.true;
      expect(r.paidTokens.toNumber()).to.eq(0);
      expect(r.tokensFromCurve.eq(q.out)).to.be.true;
      expect(r.tokensFromArtist.eq(q.out)).to.be.true;
      expect(r.burned.eq(burnC.muln(2))).to.be.true;
      expect(r.toRewards.eq(rewardsC.muln(2))).to.be.true;
      expect(r.lamportsToCurve.eq(q.net.add(q.fee))).to.be.true;
      expect(r.lamportsToArtist.eq(artistHalf)).to.be.true;
      expect(r.edition).to.eq(1);
      const a = await fetchAsset(umi, umiPk(asset.toBase58()));
      expect(a.owner.toString()).to.eq(buyer.publicKey.toBase58());
      expect(a.name).to.eq("Exclusive drop #1");

      const c1 = await program.account.curve.fetch(curve);
      expect(c1.tokensSold.sub(c0.tokensSold).eq(q.out)).to.be.true;
      expect(c1.artistReserveUsed.eq(q.out)).to.be.true;
      expect(c1.virtualSolReserves.sub(c0.virtualSolReserves).eq(q.net)).to.be.true;
      expect(c1.realSolReserves.sub(c0.realSolReserves).eq(q.net)).to.be.true;
      expect((await program.account.artist.fetch(artist)).revenueLamports.eq(artistHalf)).to.be.true;
      expect((await program.account.perk.fetch(perk)).sold).to.eq(1);
      // the curve half counts against the anti-whale cap
      const spent = (await program.account.spendTracker.fetch(spendPda(curve, buyer.publicKey))).spentLamports;
      expect(spent.sub(before.spent).eq(curveHalf)).to.be.true;
   });

   it("routes each perk through the payment instruction that matches its price", async () => {
      await expectError(redeem(buyer, DROP, DROP_PRICE), "WrongPerkPayment");
      await expectError(buyPerk(buyer, MUSIC, new BN(LAMPORTS_PER_SOL)), "WrongPerkPayment");
   });

   it("enforces the perk start time and limited supplies", async () => {
      await buyExactOut(buyer, tokens(100_000));
      await expectError(redeem(buyer, EVENT), "SaleNotStarted");
      const { receipt } = await redeem(buyer, MERCH);
      expect((await program.account.receipt.fetch(receipt)).edition).to.eq(1);
      await expectError(redeem(buyer, MERCH), "PerkSoldOut");
   });

   it("blocks blacklisted wallets from redeeming and from buying perks", async () => {
      await buyExactOut(other, tokens(10_000));
      await program.methods
         .setBlacklist(other.publicKey, true)
         .accountsPartial({ admin: admin.publicKey, config, entry: blacklistPda(other.publicKey), systemProgram: SystemProgram.programId })
         .preInstructions([uniq()])
         .rpc();
      await expectError(redeem(other, MUSIC), "Blacklisted");
      await expectError(buyPerk(other, DROP), "Blacklisted");
      await program.methods
         .setBlacklist(other.publicKey, false)
         .accountsPartial({ admin: admin.publicKey, config, entry: blacklistPda(other.publicKey), systemProgram: SystemProgram.programId })
         .preInstructions([uniq()])
         .rpc();
      await redeem(other, MUSIC);
   });

   it("lets the artist fulfill receipts", async () => {
      const receipts = await program.account.receipt.all([{ memcmp: { offset: 10, bytes: buyer.publicKey.toBase58() } }]);
      expect(receipts.length).to.be.greaterThanOrEqual(3);
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

   // ================================================================================================
   // governance
   // ================================================================================================

   it("appoints members through proposals; the founding super-admin alone passes 2 of 2", async () => {
      // a non-member has no Member PDA, so Anchor refuses the account before the handler runs
      await expectError(propose(other, { kind: PROPOSAL_SET_MEMBER, wallet: other.publicKey, role: ROLE_SUPER_ADMIN }), "AccountNotInitialized");
      await expectError(propose(admin, { kind: PROPOSAL_SET_MEMBER, wallet: member1.publicKey, role: 3 }), "InvalidRole");
      await expectError(propose(admin, { kind: 7 }), "InvalidProposalKind");

      await appoint(member1.publicKey, ROLE_ADMIN);
      let c = await program.account.config.fetch(config);
      expect(c.totalWeight).to.eq(3);
      expect(c.memberCount).to.eq(2);
      expect((await program.account.member.fetch(memberPda(member1.publicKey))).role).to.eq(ROLE_ADMIN);

      // 2 of 3 = 66 % > 51 %: the founder still passes alone
      await appoint(member2.publicKey, ROLE_SUPER_ADMIN);
      c = await program.account.config.fetch(config);
      expect(c.totalWeight).to.eq(5);
      expect(c.memberCount).to.eq(3);
   });

   it("moves cold-vault tokens only once approvals exceed 51% of the live weight", async () => {
      const amount = tokens(1_000_000);
      const dest = ata(artistAuthority.publicKey);
      await provider.sendAndConfirm(new anchor.web3.Transaction().add(createAssociatedTokenAccountInstruction(admin.publicKey, dest, artistAuthority.publicKey, mint)), []);
      // member1 (weight 1 of 5) proposes: 20 % is not enough
      const p = await propose(member1, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_ARTIST_RESERVE, destination: dest, amount });
      expect((await program.account.proposal.fetch(p)).approvedWeight).to.eq(1);
      await expectError(executeTokenTransfer(member1, p, artistReserve, dest), "ThresholdNotMet");
      // a member cannot approve twice (the approval PDA already exists)
      await expectError(approve(member1, p), "already in use");
      // member2 (weight 2) approves: 3 of 5 = 60 %
      await approve(member2, p);
      expect((await program.account.proposal.fetch(p)).approvedWeight).to.eq(3);
      // the source must be the vault the proposal names
      await expectError(executeTokenTransfer(member1, p, mostroReserve, dest), "ProposalMismatch");
      const before = (await getAccount(conn, artistReserve)).amount;
      await executeTokenTransfer(member1, p, artistReserve, dest);
      expect((before - (await getAccount(conn, artistReserve)).amount).toString()).to.eq(amount.toString());
      expect((await getAccount(conn, dest)).amount.toString()).to.eq(amount.toString());
      // a proposal executes once
      await expectError(executeTokenTransfer(member2, p, artistReserve, dest), "ProposalClosed");
      await expectError(approve(admin, p), "ProposalClosed");
      expect((await program.account.proposal.fetch(p)).executed).to.be.true;
   });

   it("withdraws treasury SOL and curve SOL only through proposals, keeping the rent floor", async () => {
      const floor = await conn.getMinimumBalanceForRentExemption(0);
      const tre = await conn.getBalance(treasury);
      expect(tre).to.be.greaterThan(floor);
      // too much: the floor must stay
      const tooMuch = await propose(admin, { kind: PROPOSAL_VAULT_TRANSFER, vault: VAULT_TREASURY_SOL, destination: other.publicKey, amount: new BN(tre) });
      await approve(member2, tooMuch);
      await expectError(executeSolTransfer(admin, tooMuch, treasury, other.publicKey, false), "InsufficientReserves");
      // treasury vaults carry no curve
      await expectError(propose(admin, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_TREASURY_SOL, destination: other.publicKey, amount: new BN(1) }), "InvalidVault");
      const p = await propose(admin, { kind: PROPOSAL_VAULT_TRANSFER, vault: VAULT_TREASURY_SOL, destination: other.publicKey, amount: new BN(tre - floor) });
      await approve(member2, p);
      const before = await conn.getBalance(other.publicKey);
      await executeSolTransfer(admin, p, treasury, other.publicKey, false);
      expect(await conn.getBalance(other.publicKey)).to.eq(before + tre - floor);
      expect(await conn.getBalance(treasury)).to.eq(floor);
      // curve SOL vault
      const c = await program.account.curve.fetch(curve);
      const half = c.realSolReserves.divn(2);
      const ps = await propose(member2, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_SOL, destination: other.publicKey, amount: half });
      await approve(admin, ps);
      const vaultBefore = await conn.getBalance(solVault);
      await executeSolTransfer(member2, ps, solVault, other.publicKey, true);
      expect(await conn.getBalance(solVault)).to.eq(vaultBefore - half.toNumber());
      expect((await program.account.curve.fetch(curve)).realSolReserves.eq(c.realSolReserves.sub(half))).to.be.true;
      // wrong executor instruction for the kind of vault
      const pt = await propose(admin, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_MOSTRO_RESERVE, destination: ata(artistAuthority.publicKey), amount: new BN(1) });
      await approve(member2, pt);
      await expectError(executeSolTransfer(admin, pt, solVault, ata(artistAuthority.publicKey), true), "InvalidVault");
   });

   it("cancels proposals (proposer or super-admin) and expires them after the TTL", async () => {
      const p = await propose(member1, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_MOSTRO_RESERVE, destination: ata(artistAuthority.publicKey), amount: new BN(1) });
      const cancel = (by: Keypair) =>
         program.methods
            .cancelProposal()
            .accountsPartial({ memberWallet: by.publicKey, member: memberPda(by.publicKey), proposal: p })
            .signers(by === admin ? [] : [by])
            .rpc();
      await program.methods
         .cancelProposal()
         .accountsPartial({ memberWallet: member1.publicKey, member: memberPda(member1.publicKey), proposal: p })
         .signers([member1])
         .rpc();
      expect((await program.account.proposal.fetch(p)).cancelled).to.be.true;
      await expectError(approve(member2, p), "ProposalClosed");
      // an admin (weight 1) who did not propose cannot cancel someone else's proposal; a super-admin can
      const p2 = await propose(member2, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_MOSTRO_RESERVE, destination: ata(artistAuthority.publicKey), amount: new BN(1) });
      await expectError(
         program.methods
            .cancelProposal()
            .accountsPartial({ memberWallet: member1.publicKey, member: memberPda(member1.publicKey), proposal: p2 })
            .signers([member1])
            .rpc(),
         "Unauthorized",
      );
      await program.methods
         .cancelProposal()
         .accountsPartial({ memberWallet: admin.publicKey, member: memberPda(admin.publicKey), proposal: p2 })
         .rpc();
      void cancel;
      // expiry
      await program.methods
         .setConfig(cfgArgs({ proposalTtlSecs: 1 }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      const p3 = await propose(member1, { kind: PROPOSAL_VAULT_TRANSFER, curve, vault: VAULT_MOSTRO_RESERVE, destination: ata(artistAuthority.publicKey), amount: new BN(1) });
      await sleep(2_500);
      await expectError(approve(member2, p3), "ProposalExpired");
      await program.methods
         .setConfig(cfgArgs({ proposalTtlSecs: PROPOSAL_TTL_SECS }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
   });

   it("lets any member pull the circuit breaker; only the admin resumes", async () => {
      await expectError(program.methods.emergencyPause().accountsPartial(memberAccounts(other.publicKey)).signers([other]).rpc(), "AccountNotInitialized");
      await program.methods.emergencyPause().accountsPartial(memberAccounts(member1.publicKey)).signers([member1]).rpc();
      const c = await program.account.config.fetch(config);
      expect(c.buysPaused).to.be.true;
      expect(c.redeemsPaused).to.be.true;
      await expectError(buySol(buyer, new BN(1_000_000)), "BuysPaused");
      await expectError(redeem(buyer, MUSIC), "RedeemsPaused");
      await expectError(buyPerk(buyer, DROP), "RedeemsPaused");
      // the breakers are independent: resume redeems only
      await program.methods
         .setConfig(cfgArgs({ redeemsPaused: false }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      await buyExactOutOrFail(buyer);
      await redeem(buyer, MUSIC);
      await expectError(buyPerk(buyer, DROP), "BuysPaused"); // the curve leg is a buy
      await program.methods
         .setConfig(cfgArgs({ buysPaused: false }) as any)
         .accountsPartial({ admin: admin.publicKey, config })
         .rpc();
      await buyPerk(buyer, DROP);
   });

   async function buyExactOutOrFail(who: Keypair) {
      await expectError(buyExactOut(who, tokens(1)), "BuysPaused");
   }

   it("removes a member through a proposal and the threshold follows", async () => {
      // remove member1: total 5 -> 4; admin (2) + member2 (2) still pass
      const p = await propose(admin, { kind: PROPOSAL_SET_MEMBER, wallet: member1.publicKey, role: ROLE_NONE });
      await approve(member2, p);
      await executeSetMember(admin, p, member1.publicKey);
      const c = await program.account.config.fetch(config);
      expect(c.totalWeight).to.eq(4);
      expect(c.memberCount).to.eq(2);
      expect((await program.account.member.fetch(memberPda(member1.publicKey))).role).to.eq(ROLE_NONE);
      await expectError(propose(member1, { kind: PROPOSAL_SET_MEMBER, wallet: member1.publicKey, role: ROLE_ADMIN }), "NotAMember");
      await expectError(program.methods.emergencyPause().accountsPartial(memberAccounts(member1.publicKey)).signers([member1]).rpc(), "NotAMember");
      // a lone super-admin can no longer pass alone: 2 of 4 = 50 %
      const p2 = await propose(admin, { kind: PROPOSAL_SET_MEMBER, wallet: member1.publicKey, role: ROLE_ADMIN });
      await expectError(executeSetMember(admin, p2, member1.publicKey), "ThresholdNotMet");
      await approve(member2, p2);
      await executeSetMember(admin, p2, member1.publicKey);
      expect((await program.account.config.fetch(config)).totalWeight).to.eq(5);
   });

   // ================================================================================================
   // admin key rotation + stats
   // ================================================================================================

   it("transfers the admin key only after the cool-off", async () => {
      await program.methods.proposeAdmin(other.publicKey).accountsPartial({ admin: admin.publicKey, config }).rpc();
      await expectError(program.methods.acceptAdmin().accountsPartial({ pendingAdmin: other.publicKey, config }).signers([other]).rpc(), "AdminTransferNotReady");
      await sleep(3_000);
      await program.methods.acceptAdmin().accountsPartial({ pendingAdmin: other.publicKey, config }).signers([other]).rpc();
      expect((await program.account.config.fetch(config)).admin.toBase58()).to.eq(other.publicKey.toBase58());
      // hand it back
      await program.methods.proposeAdmin(admin.publicKey).accountsPartial({ admin: other.publicKey, config }).signers([other]).rpc();
      await sleep(3_000);
      await program.methods.acceptAdmin().accountsPartial({ pendingAdmin: admin.publicKey, config }).rpc();
      await expectError(program.methods.acceptAdmin().accountsPartial({ pendingAdmin: admin.publicKey, config }).preInstructions([uniq()]).rpc(), "Unauthorized");
   });

   it("reports consistent supply accounting", async () => {
      const c = await program.account.curve.fetch(curve);
      const supply = (await getMint(conn, mint)).supply;
      const vaults = await Promise.all([curveVault, artistReserve, mostroReserve, dexReserve, rewardsVault].map((v) => getAccount(conn, v).then((a) => a.amount)));
      expect(c.complete).to.be.false;
      expect(c.totalBurned.toNumber()).to.be.greaterThan(0);
      // supply = total - burned
      expect(TOTAL_SUPPLY.toString() === (supply + BigInt(c.totalBurned.toString())).toString()).to.be.true;
      // tokens_sold = what left the hot vault
      expect(c.tokensSold.toString()).to.eq((BigInt(CURVE_ALLOCATION.toString()) - vaults[0]).toString());
      // artist reserve = allocation - hybrid use - governance transfers (1,000,000 moved above)
      expect(vaults[1].toString()).to.eq((BigInt(ARTIST_ALLOCATION.toString()) - BigInt(c.artistReserveUsed.toString()) - BigInt(tokens(1_000_000).toString())).toString());
      expect(vaults[2].toString()).to.eq(MOSTRO_ALLOCATION.toString());
      expect(vaults[3].toString()).to.eq(DEX_ALLOCATION.toString());
      expect(vaults[4].toString()).to.eq(c.rewardsAccrued.toString());
   });
});
