# Frontend handoff: the `mostro` program

Reader: a frontend developer who builds and signs transactions against the `mostro` Solana program. After reading, you can derive every address, build every user instruction, read every account, and know how much SOL each flow costs.

The code is the source of truth. When this document and the program disagree, the program wins; open an issue.

This version implements the contract logic agreed in the 2026-10-13 review. **It is a breaking change for every client**: instruction names, account lists, argument structs, account layouts and error codes all changed. Section 12 lists what moved. The devnet deployment of this version is pending (see the README for the upgrade steps); until it lands, devnet still runs the previous version.

## 1. Identifiers

| Item                                 | Value                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Program id (localnet and devnet)     | `4GZtfZvBFXy2YP69kE5cGL1UXjyqhSoZvQPtLtoAVDvG`                                                |
| Anchor version                       | 0.32.1                                                                                        |
| IDL                                  | `target/idl/mostro.json` (copied to `shared/idl/mostro.json` by `yarn export:shared`)         |
| TypeScript type                      | `target/types/mostro.ts`, exported type `Mostro` (copied to `shared/types/mostro.ts`)         |
| Addresses per cluster                | `shared/addresses/devnet.json` (written by the seed)                                          |
| Token decimals                       | 6 (`1 token = 1_000_000` base units), every artist token                                      |
| Fixed supply per artist token        | `1_000_000_000` tokens: 280M curve, 70M DEX reserve, 150M Mostro reserve, 500M artist reserve |
| Devnet USDC mint                     | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals, Tokenkeg)                         |
| Metaplex Core program                | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`                                                |
| Metaplex Token Metadata program      | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` (token metadata, created by `create_curve`)     |
| Pyth SOL/USD `PriceUpdateV2` account | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`                                                |
| Pyth SOL/USD feed id                 | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`                            |
| Pyth receiver program                | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`                                                 |

Import addresses from `shared/addresses/devnet.json`. Do not copy constants by hand into the apps. The program id is the only value that is safe to hardcode, because the PDAs below derive from it.

### What the program does, in one paragraph

Each artist gets one SPL token with a fixed supply of 1B, minted once and split into a hot vault (28 %, sold on a buy-only bonding curve) and three cold reserves (artist 50 %, Mostro 15 %, DEX 7 %) that only a weighted multisig can move. The curve opens 24 h after the token is created, serves tokens from the hot vault for SOL or USDC, refuses blacklisted wallets, enforces a per-wallet monthly SOL cap, and has no sell. Fans spend tokens on perks (`redeem_perk`) or pay SOL for hybrid perks (`buy_perk_sol`: half of the SOL buys on the curve, half pays the artist, and the same number of tokens leaves the artist reserve); every perk burns 80 % of the tokens involved and sends 20 % to a rewards vault, then mints a Metaplex Core asset whose attributes (`kind`, `tier`, `artist`, `edition`) the web app reads to apply benefits. **Pass benefits (discounts, early access, VIP areas) are a web-app concern now, not an on-chain one.**

### Terminology

| Concept                                      | Term used in this document   | Not used            |
| -------------------------------------------- | ---------------------------- | ------------------- |
| An artist's SPL token (curve mint)           | token                        | coin, points, $MOST |
| A `Perk` account (pass, music, event, merch) | perk                         | tier, product, drop |
| A perk with `price_lamports > 0`             | hybrid perk (SOL-priced)     | paid perk           |
| A Mostro Pass Metaplex Core asset            | pass                         | NFT, membership     |
| The Metaplex Core account minted on redeem   | asset                        | NFT                 |
| `redeem_perk` / `buy_perk_sol`               | redeem / buy perk            | purchase            |
| `buy_tokens_*`                               | buy                          | swap, trade, sell   |
| The wallet that signs a user instruction     | buyer                        | user, customer      |
| The signer that pays rent and Core fees      | payer (defaults to buyer)    | sponsor, relayer    |
| A governance voter (`Member` PDA)            | member (admin / super-admin) | signer, owner       |

## 2. Setup with `@coral-xyz/anchor`

```ts
import { Program, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import idl from "../shared/idl/mostro.json";
import type { Mostro } from "../shared/types/mostro";

const connection = new Connection(rpcUrl, "confirmed");
// Read-only program: no wallet. Use `.instruction()` on method builders and sign elsewhere.
const program = new Program<Mostro>(idl as Mostro, { connection });
const PROGRAM_ID = program.programId;
```

Account names in TypeScript are camelCase versions of the IDL names: `buyer_ata` becomes `buyerAta`, `blacklist_entry` becomes `blacklistEntry`. Argument names follow the same rule.

Use `.accountsStrict({...})` and pass every account. Automatic resolution works for most PDAs, but strict mode makes the transaction deterministic and avoids extra RPC fetches for `has_one` relations.

### The `@mostro/shared` package

The `shared` workspace package wraps everything in this document. Prefer it over hand-written derivations; the sections below explain what it does so you can debug it.

| Need           | Export from `@mostro/shared`                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program handle | `createReadonlyProgram(connection)`, `createProgram(connection, wallet)`                                                                                                                                                                                                                                                                                                                                                                 |
| PDAs           | `configPda()`, `curvePda(i)`, `mintPda(i)`, `artistPda(j)`, `perkPda(artist, k)`, `assetPda(perk, nonce)`, `receiptPda(asset)`, `blacklistPda(wallet)`, `spendPda(curve, wallet)`, `memberPda(wallet)`, `proposalPda(i)`, `approvalPda(proposal, wallet)`, `deriveCurveAddresses(i)`, `derivePerkAddresses(j, k)`                                                                                                                        |
| Quotes         | `quoteBuyExactIn`, `quoteBuyExactOut`, `quoteHybridPerk`, `splitRedeem`, `spotPrice`, `marketCap`, `progressToGraduationBps`, `remainingSupply`, `minOut`, `maxIn`                                                                                                                                                                                                                                                                       |
| SOL/USD        | `solUsdFromConfig(config, pythAccountData?)`, `decodePriceUpdateV2`, `usdE6ToLamports`                                                                                                                                                                                                                                                                                                                                                   |
| Instructions   | `buildBuyTokensSol`, `buildBuyTokensExactOutSol`, `buildBuyTokensUsdc`, `buildRedeemPerk`, `buildBuyPerkSol`, `prepare*` variants, `randomNonce()`; artist side: `buildCreatePerk`, `buildSetPerk`, `buildFulfillReceipt`; admin: `buildCreateCurve`, `buildSetBlacklist`; governance: `buildCreateProposal`, `buildApproveProposal`, `buildCancelProposal`, `buildExecuteVaultTransfer`, `buildExecuteSetMember`, `buildEmergencyPause` |
| Reads          | `fetchConfig`, `fetchCurve`, `fetchCurveSnapshot`, `fetchArtist`, `fetchPerk`, `listPerks`, `listReceiptsByBuyer`, `fetchBlacklist` / `isBlacklisted`, `fetchSpend` / `remainingSpend`, `fetchMember`, `listMembers`, `listProposals`, `listApprovals`, `redeemEligibility`, `curveEligibility`, `perkPayment`, `checkPerkPrice`, `meetsThreshold`, `weightNeeded`                                                                       |
| Passes         | `findPassForBuyer(connection, buyer, passPerks)`, `findPassesForBuyer`, `isVip` (for the web app's own benefit logic)                                                                                                                                                                                                                                                                                                                    |
| Holders        | `topHolders(connection, mint, exclude)`                                                                                                                                                                                                                                                                                                                                                                                                  |
| Errors         | `MOSTRO_ERRORS_BY_CODE`, `ERROR_COPY`, `parseMostroError`, `errorCopy`                                                                                                                                                                                                                                                                                                                                                                   |

Each `build*` function returns `{ instruction, derived }`, where `derived` holds every address it resolved (for `buildRedeemPerk`: `asset`, `receipt`, `nonce`, `payer`, `blacklistEntry`). Every buy and redeem builder accepts an optional `payer`; omit it and the buyer pays its own rent (one signer). Pass a sponsor key to build a gas-sponsored instruction (two signers; see 4.3).

## 3. PDA seed table

All PDAs derive from the program id. Integers are little-endian. `u32` means 4 bytes, `u64` means 8 bytes.

| Account          | Seeds                                               | Owner / type                                                                                       |
| ---------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `config`         | `["config"]`                                        | program, `Config`                                                                                  |
| `treasury`       | `["treasury"]`                                      | System program (holds SOL fees)                                                                    |
| `treasury_usdc`  | ATA(owner = `config`, mint = USDC)                  | Token program                                                                                      |
| `curve`          | `["curve", curve_index: u32]`                       | program, `Curve`                                                                                   |
| `mint`           | `["mint", curve_index: u32]`                        | Token program (mint authority = none, supply fixed)                                                |
| `curve_vault`    | `["curve_vault", curve]`                            | Token account (authority = `curve`), hot vault: tokens for sale                                    |
| `artist_reserve` | `["artist_reserve", curve]`                         | Token account (authority = `curve`), cold                                                          |
| `mostro_reserve` | `["mostro_reserve", curve]`                         | Token account (authority = `curve`), cold                                                          |
| `dex_reserve`    | `["dex_reserve", curve]`                            | Token account (authority = `curve`), cold                                                          |
| `rewards_vault`  | `["rewards", curve]`                                | Token account (authority = `curve`), 20 % of every redeem                                          |
| `sol_vault`      | `["sol_vault", curve]`                              | System program (SOL paid on the curve)                                                             |
| `usdc_vault`     | ATA(owner = `curve`, mint = USDC)                   | Token program                                                                                      |
| `metadata`       | `["metadata", metaqbx…, mint]` under Token Metadata | Token Metadata (created by `create_curve`)                                                         |
| `artist`         | `["artist", artist_index: u32]`                     | program, `Artist`                                                                                  |
| `perk`           | `["perk", artist, perk_index: u32]`                 | program, `Perk`                                                                                    |
| `collection`     | `["collection", perk, collection_salt: u64]`        | Metaplex Core `BaseCollectionV1` (salt = `CreatePerkArgs.collection_salt`; read `perk.collection`) |
| `asset`          | `["asset", perk, nonce: u64]`                       | Metaplex Core `BaseAssetV1`                                                                        |
| `receipt`        | `["receipt", asset]`                                | program, `Receipt`                                                                                 |
| `blacklist`      | `["blacklist", wallet]`                             | program, `Blacklist` (usually does not exist)                                                      |
| `spend`          | `["spend", curve, wallet]`                          | program, `SpendTracker` (created on the wallet's first buy)                                        |
| `member`         | `["member", wallet]`                                | program, `Member`                                                                                  |
| `proposal`       | `["proposal", proposal_index: u64]`                 | program, `Proposal`                                                                                |
| `approval`       | `["approval", proposal, wallet]`                    | program, `Approval`                                                                                |

Curve index 0 is the first artist's token (artist 0). Derived devnet values for curve 0 (deterministic, listed for cross-checking):

| PDA               | Address                                        |
| ----------------- | ---------------------------------------------- |
| `config`          | `DkvJHPjVai7sSTyU4v2WPM5roYWNguDMw4mmHGmWkUun` |
| `treasury`        | `Ad15qUyGCQVqnaVdWXMxjtUHqQu1K7swAPh8mYUuQfJf` |
| `curve` (index 0) | `EBes4GAtgZf9zHy2hwG8AmN8AQE9UmgtMyGQct21tpKR` |
| `mint` (index 0)  | `Cv1BGNwGaGGoBsqb2WoYEPiaSN38XBJhY92xvteF4wmW`  |

Derivation in web3.js v1:

```ts
const u32le = (n: number) => {
   const b = Buffer.alloc(4);
   b.writeUInt32LE(n);
   return b;
};
const u64le = (n: BN) => n.toArrayLike(Buffer, "le", 8);
const pda = (seeds: (Buffer | Uint8Array)[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

const config = pda([Buffer.from("config")]);
const treasury = pda([Buffer.from("treasury")]);
const curve = pda([Buffer.from("curve"), u32le(0)]);
const mint = pda([Buffer.from("mint"), u32le(0)]);
const curveVault = pda([Buffer.from("curve_vault"), curve.toBuffer()]);
const artistReserve = pda([Buffer.from("artist_reserve"), curve.toBuffer()]);
const solVault = pda([Buffer.from("sol_vault"), curve.toBuffer()]);
const rewardsVault = pda([Buffer.from("rewards"), curve.toBuffer()]);
const artist = pda([Buffer.from("artist"), u32le(artistIndex)]);
const perk = pda([Buffer.from("perk"), artist.toBuffer(), u32le(perkIndex)]);
const asset = pda([Buffer.from("asset"), perk.toBuffer(), u64le(nonce)]);
const receipt = pda([Buffer.from("receipt"), asset.toBuffer()]);
const blacklistEntry = pda([Buffer.from("blacklist"), buyer.toBuffer()]);
const spend = pda([Buffer.from("spend"), curve.toBuffer(), buyer.toBuffer()]);
```

Associated token accounts use `getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID)` from `@solana/spl-token`. Pass `allowOwnerOffCurve = true` when the owner is a PDA (`config`, `curve`).

## 4. Instructions

Accounts are listed in IDL order. `mut` = writable, `signer` = must sign, `optional` = may be `null`. Every user flow is signed by the buyer. Buys and both perk instructions also list a `payer` signer first: in the normal case it is the same key as `buyer`, so the transaction still has one signer; a gas sponsor puts its own key there and co-signs (4.3). Admin, artist and governance instructions are listed for completeness; the fan app does not call them.

### 4.1 User instructions

#### `buy_tokens_sol(lamports_in: u64, min_tokens_out: u64)`

Buy tokens with an exact amount of SOL. Fee is taken from `lamports_in`; the rest enters the curve. Tokens come out of `curve_vault`. `buyer` pays the SOL; `payer` pays the rent of `buyer_ata` and `spend` when they are created.

| #   | Account                    | Flags                                                          |
| --- | -------------------------- | -------------------------------------------------------------- |
| 1   | `payer`                    | mut, signer (rent payer; normally `== buyer`)                  |
| 2   | `buyer`                    | mut, signer                                                    |
| 3   | `config`                   |                                                                |
| 4   | `curve`                    | mut                                                            |
| 5   | `mint`                     |                                                                |
| 6   | `curve_vault`              | mut, `["curve_vault", curve]`                                  |
| 7   | `sol_vault`                | mut                                                            |
| 8   | `treasury`                 | mut                                                            |
| 9   | `buyer_ata`                | mut (created if missing, `payer` pays the rent)                |
| 10  | `spend`                    | mut, `["spend", curve, buyer]` (created if missing)            |
| 11  | `blacklist_entry`          | `["blacklist", buyer]`, always passed, usually empty (see 4.4) |
| 12  | `token_program`            | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`                  |
| 13  | `associated_token_program` | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`                 |
| 14  | `system_program`           | `11111111111111111111111111111111`                             |

#### `buy_tokens_exact_out_sol(tokens_out: u64, max_lamports_in: u64)`

Buy an exact number of tokens. The program charges `cost + fee` and fails with `SlippageExceeded` when that exceeds `max_lamports_in`. Same accounts as `buy_tokens_sol`.

#### `buy_tokens_usdc(usdc_in: u64, min_tokens_out: u64)`

Buy tokens with USDC. The program converts `usdc_in` to a SOL equivalent at the configured SOL/USD price and applies it to the SOL-quoted curve. USDC stays in the curve's `usdc_vault`; the SOL equivalent counts against the monthly cap.

| #   | Account                    | Flags                                                                                |
| --- | -------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `payer`                    | mut, signer (rent payer; normally `== buyer`)                                        |
| 2   | `buyer`                    | signer (owns the USDC, receives the tokens)                                          |
| 3   | `config`                   |                                                                                      |
| 4   | `curve`                    | mut                                                                                  |
| 5   | `mint`                     |                                                                                      |
| 6   | `curve_vault`              | mut                                                                                  |
| 7   | `usdc_mint`                | must equal `config.usdc_mint`                                                        |
| 8   | `buyer_usdc`               | mut, buyer's USDC token account (must exist)                                         |
| 9   | `usdc_vault`               | mut, ATA(`curve`, USDC)                                                              |
| 10  | `treasury_usdc`            | mut, ATA(`config`, USDC)                                                             |
| 11  | `buyer_ata`                | mut (created if missing, `payer` pays the rent)                                      |
| 12  | `spend`                    | mut (created if missing)                                                             |
| 13  | `blacklist_entry`          | see 4.4                                                                              |
| 14  | `price_update`             | Pyth `PriceUpdateV2` account; always passed, only read when `config.price_mode == 1` |
| 15  | `token_program`            | Tokenkeg                                                                             |
| 16  | `usdc_token_program`       | Tokenkeg                                                                             |
| 17  | `associated_token_program` |                                                                                      |
| 18  | `system_program`           |                                                                                      |

#### There is no sell

The primary market is buy-only. Do not show a sell button; holders exit on the DEX after graduation. `curve.complete == true` means the 280M allocation is sold out and the curve is closed for good.

#### `redeem_perk(nonce: u64, max_paid: u64)` (token-priced perks)

Pay `perk.price_tokens` from the buyer's wallet: 80 % burned, 20 % to `rewards_vault`. Mints a Metaplex Core asset into the perk's collection for the buyer and writes a `Receipt`. Use only when `perk.price_tokens > 0` (`WrongPerkPayment` otherwise).

| #   | Account            | Flags                                                           |
| --- | ------------------ | --------------------------------------------------------------- |
| 1   | `payer`            | mut, signer (rent + Core fee payer; normally `== buyer`)        |
| 2   | `buyer`            | signer                                                          |
| 3   | `config`           |                                                                 |
| 4   | `artist`           | `perk.artist`                                                   |
| 5   | `perk`             | mut                                                             |
| 6   | `curve`            | mut, the curve whose `mint == perk.mint` (`artist.curve`)       |
| 7   | `mint`             | mut, `perk.mint`                                                |
| 8   | `buyer_ata`        | mut, buyer's token account (must exist and hold `price_tokens`) |
| 9   | `rewards_vault`    | mut, `["rewards", curve]`                                       |
| 10  | `collection`       | mut, `perk.collection`                                          |
| 11  | `asset`            | mut, `["asset", perk, nonce]`                                   |
| 12  | `receipt`          | mut, `["receipt", asset]`                                       |
| 13  | `blacklist_entry`  | see 4.4                                                         |
| 14  | `mpl_core_program` | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`                  |
| 15  | `token_program`    |                                                                 |
| 16  | `system_program`   |                                                                 |

`nonce` is a random `u64` generated by the client. It only exists to make `asset` unique: two buyers in the same slot never collide, and the client knows the asset address before the transaction confirms. If a nonce was already used for this perk, Core fails because the asset account exists; retry with a new nonce.

```ts
const nonce = new BN(crypto.getRandomValues(new Uint8Array(8)), "le");
```

`max_paid` caps what the buyer pays: the program fails with `SlippageExceeded` (6006) when `perk.price_tokens > max_paid`, so a `set_perk` price change between the quote and the confirmation cannot overcharge. Pass exactly `perk.price_tokens` (`prepareRedeemPerk` does). `collection` is `perk.collection` from the fetched account; the salt is not stored on-chain, so do not re-derive it.

#### `buy_perk_sol(nonce: u64, max_lamports: u64)` (hybrid, SOL-priced perks)

Pay `perk.price_lamports`. Half of it buys on the curve (fee to the treasury, net to `sol_vault`, tokens out of `curve_vault`); the other half goes to `artist.authority`; the same number of tokens leaves `artist_reserve`. All of those tokens are burned 80 % / sent to rewards 20 % inside the vaults, so **the buyer needs no token account** and never holds the tokens. Mints the Core asset and writes the receipt exactly like `redeem_perk`. Use only when `perk.price_lamports > 0` (`WrongPerkPayment` otherwise). Because the curve leg is a buy, it also requires the curve to be open (not paused, not complete, past its cool-down) and counts the curve half against the monthly cap.

| #   | Account            | Flags                                                         |
| --- | ------------------ | ------------------------------------------------------------- |
| 1   | `payer`            | mut, signer (rent + Core fee payer; normally `== buyer`)      |
| 2   | `buyer`            | mut, signer (pays the SOL, receives the asset)                |
| 3   | `config`           |                                                               |
| 4   | `artist`           | mut                                                           |
| 5   | `artist_authority` | mut, must equal `artist.authority` (fetch the artist account) |
| 6   | `perk`             | mut                                                           |
| 7   | `curve`            | mut, `artist.curve`                                           |
| 8   | `mint`             | mut                                                           |
| 9   | `curve_vault`      | mut                                                           |
| 10  | `artist_reserve`   | mut, `["artist_reserve", curve]`                              |
| 11  | `rewards_vault`    | mut                                                           |
| 12  | `sol_vault`        | mut                                                           |
| 13  | `treasury`         | mut                                                           |
| 14  | `spend`            | mut (created if missing)                                      |
| 15  | `blacklist_entry`  | see 4.4                                                       |
| 16  | `collection`       | mut, `perk.collection`                                        |
| 17  | `asset`            | mut, `["asset", perk, nonce]`                                 |
| 18  | `receipt`          | mut, `["receipt", asset]`                                     |
| 19  | `mpl_core_program` |                                                               |
| 20  | `token_program`    |                                                               |
| 21  | `system_program`   |                                                               |

`max_lamports` is the SOL price cap (`SlippageExceeded` when `perk.price_lamports` is higher); pass exactly `perk.price_lamports`. The tokens involved depend on the curve state at execution; `quoteHybridPerk(curve, perk.priceLamports, config.feeBps)` previews them (tokens from each vault, burned, to rewards, SOL to the curve and to the artist).

### 4.2 Which instruction for which perk

| `perk.price_tokens` | `perk.price_lamports` | Instruction    | Buyer needs                             |
| ------------------- | --------------------- | -------------- | --------------------------------------- |
| `> 0`               | `0`                   | `redeem_perk`  | `price_tokens` in its token account     |
| `0`                 | `> 0`                 | `buy_perk_sol` | `price_lamports` SOL (plus rent / fees) |

`perkPayment(perk)` in `@mostro/shared` returns `"tokens"` or `"sol"`.

### 4.3 The `payer` account (gas sponsorship)

`buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc`, `redeem_perk` and `buy_perk_sol` take a `payer` signer before `buyer`. The program charges `payer` for every account it creates (`buyer_ata` and `spend` on the first buy, `receipt` and the Core `asset` on redeem) and for the Metaplex Core protocol fee. It never charges `payer` for the trade itself: the SOL, USDC or tokens always come from `buyer`, and the tokens and the asset always go to `buyer`.

| Case                         | `payer`                  | Signers           | Transaction `feePayer` |
| ---------------------------- | ------------------------ | ----------------- | ---------------------- |
| Self-paid (default)          | the buyer's key          | buyer             | buyer                  |
| Sponsored (Openfort or Kora) | the sponsor's funded key | buyer and sponsor | the sponsor            |

How a sponsor uses it: the app builds the instruction with `payer = sponsor`, sets the transaction fee payer to the same sponsor key, has the buyer sign, then sends the partially signed transaction to the sponsor (Kora's `signAndSendTransaction`, or Openfort's gas policy on the embedded wallet). The sponsor inspects the instruction, co-signs and broadcasts. The on-chain check is only "`payer` signed", so the sponsor must inspect what it co-signs. With `@mostro/shared`, pass `payer: sponsorKey` to the builders; `derived.payer` echoes what was encoded.

### 4.4 The `blacklist_entry` account

Every buy and redeem passes `["blacklist", buyer]`. **Always pass it, even though it almost never exists**: the program checks the address against the seeds (so the client cannot pass someone else's entry; `ConstraintSeeds` 2006 otherwise) and then reads it only if it exists. An empty account means the wallet was never blacklisted. An existing entry with `blocked == true` fails with `Blacklisted` (6028); the admin can unblock, which keeps the entry with `blocked == false`. Pre-flight: `isBlacklisted(program, wallet)` and show a "this account is restricted" state instead of the buttons.

There is no on-chain KYC any more: identity runs at the Openfort / Sumsub layer. Nothing personal is stored on-chain; a blacklist entry is the wallet, a flag and a timestamp.

### 4.5 Admin, artist and governance instructions (reference)

| Instruction              | Args                                           | Signer                                                                      | Accounts in order                                                                                                                                                                                                                                                                                          |
| ------------------------ | ---------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize_config`      | `args: InitializeConfigArgs`                   | program upgrade authority                                                   | `payer`, `config`, `treasury`, `usdc_mint`, `treasury_usdc`, `admin_member` (`["member", args.admin]`), `program`, `program_data`, `usdc_token_program`, `associated_token_program`, `system_program`                                                                                                      |
| `set_config`             | `args: SetConfigArgs` (all fields `Option`)    | admin                                                                       | `admin`, `config`                                                                                                                                                                                                                                                                                          |
| `emergency_pause`        |                                                | any member                                                                  | `member_wallet`, `config`, `member`                                                                                                                                                                                                                                                                        |
| `propose_admin`          | `new_admin: Pubkey`                            | admin                                                                       | `admin`, `config`                                                                                                                                                                                                                                                                                          |
| `cancel_admin_transfer`  |                                                | admin                                                                       | `admin`, `config`                                                                                                                                                                                                                                                                                          |
| `accept_admin`           |                                                | pending admin                                                               | `pending_admin`, `config`                                                                                                                                                                                                                                                                                  |
| `set_blacklist`          | `wallet: Pubkey, blocked: bool`                | admin                                                                       | `admin`, `config`, `entry` (`["blacklist", wallet]`), `system_program`                                                                                                                                                                                                                                     |
| `create_proposal`        | `args: CreateProposalArgs`                     | any member                                                                  | `proposer`, `config`, `member`, `proposal` (`["proposal", config.proposal_count]`), `approval` (`["approval", proposal, proposer]`), `system_program`                                                                                                                                                      |
| `approve_proposal`       |                                                | any member (once per proposal)                                              | `member_wallet`, `config`, `member`, `proposal`, `approval`, `system_program`                                                                                                                                                                                                                              |
| `cancel_proposal`        |                                                | the proposer or a super-admin                                               | `member_wallet`, `member`, `proposal`                                                                                                                                                                                                                                                                      |
| `execute_token_transfer` |                                                | any member, threshold met                                                   | `member_wallet`, `config`, `member`, `proposal`, `curve` (optional: `null` for `treasury_usdc`), `mint`, `source` (the vault named by the proposal), `destination` (`proposal.destination`), `token_program`                                                                                               |
| `execute_sol_transfer`   |                                                | any member, threshold met                                                   | `member_wallet`, `config`, `member`, `proposal`, `curve` (optional: `null` for the treasury), `source` (`sol_vault` or `treasury`), `destination`, `system_program`                                                                                                                                        |
| `execute_set_member`     |                                                | any member, threshold met                                                   | `member_wallet`, `config`, `member`, `proposal`, `target` (`["member", proposal.wallet]`), `system_program`                                                                                                                                                                                                |
| `create_curve`           | `args: CreateCurveArgs`                        | admin                                                                       | `admin`, `config`, `artist`, `curve`, `mint`, `curve_vault`, `artist_reserve`, `mostro_reserve`, `dex_reserve`, `rewards_vault`, `sol_vault`, `usdc_mint`, `usdc_vault`, `metadata`, `token_program`, `usdc_token_program`, `associated_token_program`, `token_metadata_program`, `system_program`, `rent` |
| `create_artist`          | `authority: Pubkey, name: String, uri: String` | admin                                                                       | `admin`, `config`, `artist`, `system_program`                                                                                                                                                                                                                                                              |
| `set_artist`             | `args: SetArtistArgs`                          | artist authority or admin; `authority` field: current artist authority only | `signer`, `config`, `artist`                                                                                                                                                                                                                                                                               |
| `create_perk`            | `args: CreatePerkArgs`                         | artist authority or admin; `kind: Pass` admin only                          | `signer`, `config`, `artist`, `curve`, `mint`, `perk`, `collection`, `mpl_core_program`, `system_program`                                                                                                                                                                                                  |
| `set_perk`               | `args: SetPerkArgs`                            | artist authority or admin; Pass perks: admin only                           | `signer`, `config`, `artist`, `perk`                                                                                                                                                                                                                                                                       |
| `fulfill_receipt`        |                                                | artist authority or admin                                                   | `signer`, `config`, `artist`, `receipt`                                                                                                                                                                                                                                                                    |

Argument structs (field order matters for Borsh; Anchor's TS client serializes from the IDL):

- `InitializeConfigArgs { admin, fee_bps: u16, sol_usd_price_e6: u64, max_price_age_secs: u32, pyth_sol_usd_account, pyth_feed_id: [u8; 32], admin_cooloff_secs: u32, admin_price_max_age_secs: u32, launch_cooldown_secs: u32, max_spend_per_period_lamports: u64, proposal_ttl_secs: u32 }`
- `SetConfigArgs { buys_paused?, redeems_paused?, price_mode?: u8, sol_usd_price_e6?, pyth_sol_usd_account?, pyth_feed_id?, max_price_age_secs?, admin_price_max_age_secs?, fee_bps?, launch_cooldown_secs?, max_spend_per_period_lamports?, proposal_ttl_secs? }`
- `CreateCurveArgs { name, symbol, uri, virtual_sol_reserves: u64, virtual_token_reserves: u64 (> 280M tokens), sale_start_ts: i64 (floored to now + launch_cooldown_secs) }`
- `CreatePerkArgs { kind: PerkKind, tier: u8, price_tokens: u64, price_lamports: u64, max_supply: u32, public_start_ts: i64, name, uri, collection_salt: u64 }`: exactly one price non-zero.
- `SetPerkArgs { price_tokens?, price_lamports?, active?, max_supply?, public_start_ts?, uri? }`: the resulting prices must still have exactly one non-zero.
- `SetArtistArgs { authority?, name?, uri?, active? }`.
- `CreateProposalArgs { kind: u8 (0 vault transfer, 1 set member), curve: Pubkey (zero for treasury vaults), vault: u8, destination: Pubkey, amount: u64, wallet: Pubkey, role: u8 }`. Vault kinds: 0 artist reserve, 1 Mostro reserve, 2 DEX reserve, 3 rewards, 4 curve USDC, 5 treasury USDC, 6 curve SOL, 7 treasury SOL. Roles: 0 remove, 1 admin (weight 1), 2 super-admin (weight 2).

`PerkKind` in TypeScript is an object with one key: `{ pass: {} }`, `{ music: {} }`, `{ event: {} }`, `{ merch: {} }`. `tier` is `0` (Classic) or `1` (VIP) for `Pass` and must be `0` for every other kind. The tier is informational: the program writes it into the asset attributes and nothing else.

## 5. Building and signing a transaction

```ts
import { ComputeBudgetProgram, SystemProgram, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// `payer` defaults to the buyer (self-paid, one signer). A sponsor passes its own key and co-signs (4.3).
async function buildRedeemTx(buyer: PublicKey, artistIndex: number, perkIndex: number, payer: PublicKey = buyer) {
   const nonce = new BN(crypto.getRandomValues(new Uint8Array(8)), "le");
   const artist = pda([Buffer.from("artist"), u32le(artistIndex)]);
   const perk = pda([Buffer.from("perk"), artist.toBuffer(), u32le(perkIndex)]);
   const perkState = await program.account.perk.fetch(perk);
   const artistState = await program.account.artist.fetch(artist);
   const curve = artistState.curve;
   const mint = perkState.mint;
   const asset = pda([Buffer.from("asset"), perk.toBuffer(), u64le(nonce)]);

   const ix = await program.methods
      .redeemPerk(nonce, perkState.priceTokens)
      .accountsStrict({
         payer,
         buyer,
         config: pda([Buffer.from("config")]),
         artist,
         perk,
         curve,
         mint,
         buyerAta: getAssociatedTokenAddressSync(mint, buyer, false, TOKEN_PROGRAM_ID),
         rewardsVault: pda([Buffer.from("rewards"), curve.toBuffer()]),
         collection: perkState.collection,
         asset,
         receipt: pda([Buffer.from("receipt"), asset.toBuffer()]),
         blacklistEntry: pda([Buffer.from("blacklist"), buyer.toBuffer()]),
         mplCoreProgram: MPL_CORE,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();

   const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ix);
   tx.feePayer = payer;
   tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
   return { tx, derived: { asset, receipt: pda([Buffer.from("receipt"), asset.toBuffer()]), nonce } };
}
```

Self-paid: `wallet.signTransaction(tx)` and `connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" })`. Sponsored: the buyer signs first (`partialSign`), the sponsor adds its signature as `feePayer` and `payer`, then broadcasts. Apart from `payer`, no other signer exists in any user instruction: every PDA signs through the program.

For `@solana/kit` apps: convert the legacy instruction with `fromLegacyTransactionInstruction` from `@solana/compat`, then build a v0 message with the kit pipeline and the compute-budget instructions. The Openfort signer returns one ed25519 signature; if it returns 65 bytes, keep the first 64.

If the blockhash expires, rebuild with a new blockhash and the same nonce. If the first attempt did land, the retry fails cleanly because the asset account exists.

### Compute units

| Instruction            | `setComputeUnitLimit`                                                                                     |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `redeem_perk`          | `300_000` (the Core `CreateV2` CPI plus a burn and a transfer; measure on devnet once deployed and lower) |
| `buy_perk_sol`         | `400_000` (two burns, two transfers, three SOL transfers and the Core CPI)                                |
| `buy_tokens_*`         | default (200,000) is enough; the first buy of a wallet also creates the ATA and the spend tracker         |
| `create_curve` (admin) | `400_000` (eight account creations, four mints, metadata, revoke)                                         |

Set `setComputeUnitPrice` to at least 1,000 microlamports on devnet when it is congested.

## 6. Money per flow

Rent on Solana clusters today is `(128 + account bytes) * 5,080` lamports (the program never hardcodes it).

| Flow                       | `buyer` pays                    | Extra SOL `payer` needs (the buyer itself unless sponsored)                                                              |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `buy_tokens_sol`           | `lamports_in` (fee included)    | first buy on a curve: ~0.0015 SOL for the token ATA (165 bytes) + ~0.0014 SOL for the `SpendTracker` (89 bytes) + tx fee |
| `buy_tokens_exact_out_sol` | `cost + fee <= max_lamports_in` | same as above                                                                                                            |
| `buy_tokens_usdc`          | `usdc_in` USDC                  | same as above. The buyer's USDC token account must already exist                                                         |
| `redeem_perk`              | `price_tokens` tokens           | receipt rent (~0.002 SOL, 299 bytes) + Core asset rent and the fixed 0.0015 SOL Core protocol fee (~0.0035 SOL) + tx fee |
| `buy_perk_sol`             | `price_lamports` SOL            | same as `redeem_perk`, plus the spend tracker on the wallet's first curve purchase                                       |

The treasury, the vaults and the `usdc_vault` exist from `initialize_config` and `create_curve`. No user pays protocol rent.

## 7. Quotes (match the on-chain integer math exactly)

All math is `u128` integer math with floor division unless stated. `VQ` = `curve.virtual_sol_reserves` (lamports), `VT` = `curve.virtual_token_reserves` (base units), `fee_bps` = `config.fee_bps`.

| Quote                                         | Formula                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Buy exact in (`buy_tokens_sol`)               | `net = (lamports_in - 1) * 10_000 / (10_000 + fee_bps)`; `fee = lamports_in - net`; `tokens_out = net * VT / (VQ + net)`                                                                                                       |
| Buy exact out (`buy_tokens_exact_out_sol`)    | `cost = tokens_out * VQ / (VT - tokens_out) + 1`; `fee = ceil(cost * fee_bps / 10_000)`; total `= cost + fee`                                                                                                                  |
| Buy with USDC                                 | `lamports_equiv = usdc_in * 1e9 / sol_usd_price_e6`, then the buy-exact-in formula on `lamports_equiv`                                                                                                                         |
| Redeem split (both modes)                     | `burned = floor(tokens * 8_000 / 10_000)`; `to_rewards = tokens - burned`                                                                                                                                                      |
| Hybrid perk                                   | `curve_half = price_lamports / 2`; `artist_half = price_lamports - curve_half`; curve leg = buy-exact-in on `curve_half`; `tokens_from_curve = tokens_from_artist = tokens_out`; split applied to each vault, totals are `2 x` |
| Spot price                                    | `VQ / VT` lamports per base unit; in SOL per whole token: `(VQ / 1e9) / (VT / 1e6)`                                                                                                                                            |
| Market cap                                    | spot price × live `mint.supply` (the fixed 1B minus everything burned)                                                                                                                                                         |
| Progress to completion                        | `curve.tokens_sold / curve.supply_cap` (`supply_cap` = 280M)                                                                                                                                                                   |
| SOL needed to complete the curve from genesis | `VQ0 * VT0 / (VT0 - supply_cap) - VQ0` (derived, never stored)                                                                                                                                                                 |

Slippage: default 1%, `min_tokens_out = tokens_out * 99 / 100`, `max_lamports_in = total * 101 / 100`. Perk prices are exact, no margin.

Demo curve parameters: `virtual_sol_reserves = 30_000_000_000` (30 SOL), `virtual_token_reserves = 379_000_000 tokens`, `supply_cap = 280_000_000 tokens`, `fee_bps = 100`. At genesis 0.1 SOL buys about 1,246,000 tokens; completing the curve takes about 85 SOL of net buys.

SOL/USD price in `price_mode 0` is `config.sol_usd_price_e6` (USD with 6 decimals), valid while `now - config.price_updated_ts <= config.admin_price_max_age_secs`. In `price_mode 1` read the Pyth account: `price: i64` at byte 73, `exponent: i32` at 89, `publish_time: i64` at 93; `price_e6 = price * 10^(6 + exponent)`. The program rejects a price older than `config.max_price_age_secs`.

## 8. Read patterns (no backend)

### Single accounts

```ts
const config = await program.account.config.fetch(configPda);
const curve = await program.account.curve.fetch(curvePda);
const artist = await program.account.artist.fetch(artistPda);
const perk = await program.account.perk.fetch(perkPda);
const receipt = await program.account.receipt.fetchNullable(receiptPda);
const blacklist = await program.account.blacklist.fetchNullable(blacklistPda); // null = allowed
const spend = await program.account.spendTracker.fetchNullable(spendPda); // null = never bought on this curve
```

Enumerate artists with `config.artist_count`, curves with `config.curve_count` (`artist.curve` points at the artist's curve), perks with `artist.perk_count`; indexes are dense from 0. Or fetch everything of one type: `program.account.perk.all()`.

### Receipts of a buyer ("my perks")

`Receipt` layout: discriminator at 0 (8 bytes), `bump` at 8, `version` at 9, `buyer` at 10, `perk` at 42, `artist` at 74, `asset` at 106.

```ts
const mine = await program.account.receipt.all([{ memcmp: { offset: 10, bytes: buyer.toBase58() } }]);
const forPerk = await program.account.receipt.all([{ memcmp: { offset: 42, bytes: perk.toBase58() } }]);
```

A receipt records the original buyer and how it was paid (`paidTokens` or `paidLamports`, plus `tokensFromCurve` / `tokensFromArtist` for hybrid perks); the asset may have moved since. For "what does this wallet hold now", use the asset owner (next section).

### Passes and perk assets of a wallet ("my passes")

Option A, Metaplex Core client (`@metaplex-foundation/mpl-core` + umi):

```ts
const assets = await fetchAssetsByOwner(umi, publicKey(owner));
const passes = assets.filter((a) => a.updateAuthority.type === "Collection" && a.updateAuthority.address === passPerk.collection.toBase58());
```

Option B, Helius DAS (`getAssetsByOwner`, or `searchAssets` with `grouping: ["collection", <collection>]`). Both return the on-chain attributes `kind`, `tier` (`Classic` / `VIP` / `-`), `artist`, `edition` that the program writes into the asset's `Attributes` plugin. The perk is identified by the asset's collection (`update_authority = Collection(perk.collection)`), or by the `Receipt` at `["receipt", asset]`.

**Pass benefits are the web app's job.** The program no longer discounts, gates or unlocks anything based on a pass. Decide the benefit (for example 30 % off a drop for a Mostro Pass holder) in the app from the pass the wallet holds, and reflect it by choosing which perk the fan buys (an artist can list a discounted perk and the app shows it only to holders) or by any off-chain mechanism. `findPassForBuyer` in `@mostro/shared` returns the best active pass a wallet holds.

### Governance (admin console)

```ts
const members = await listMembers(program); // role 1 admin (weight 1), 2 super-admin (weight 2)
const proposals = await listProposals(program, true); // open ones
const approvals = await listApprovals(program, proposalKey);
const needed = weightNeeded(config.totalWeight); // smallest approved weight that passes
```

### Top holders

`connection.getTokenLargestAccounts(mint)` returns the 20 largest token accounts. Resolve owners with `connection.getMultipleParsedAccounts(addresses)` and read `parsed.info.owner`. Filter out the curve PDA (it owns `curve_vault`, the three reserves and `rewards_vault`). For all holders use Helius DAS `getTokenAccounts({ mint })` and sort client-side.

### Live updates

`program.addEventListener("tokensBought", cb)` (`quoteKind` 0 SOL, 1 USDC, 2 curve leg of a hybrid perk), `"perkRedeemed"` (both payment modes), `"receiptFulfilled"`, `"blacklistUpdated"`, `"emergencyPaused"`; admin/artist side: `"perkCreated"`, `"perkUpdated"`, `"artistCreated"`, `"artistUpdated"`, `"curveCreated"`, `"configUpdated"`, `"configInitialized"`, `"adminProposed"`, `"adminAccepted"`, `"adminTransferCancelled"`; governance: `"memberUpdated"`, `"proposalCreated"`, `"proposalApproved"`, `"proposalExecuted"`, `"proposalCancelled"`, `"vaultTransferred"` (21 events in total). `tokensBought` carries the post-trade virtual reserves, so a price chart needs no extra fetch. Polling `curve` every few seconds is the fallback.

### Counters

`curve.tokens_sold` (left the hot vault), `curve.artist_reserve_used` (left the artist reserve through hybrid perks), `curve.total_burned`, `curve.rewards_accrued`, `curve.real_sol_reserves`, `artist.revenue_lamports`, `perk.sold`, `mint.supply` (live, reflects burns).

## 9. Pre-flight checks before enabling a button

| Button          | Check                                                                                                                                                                                                                                                                                  |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any             | `isBlacklisted(wallet) == false`, else show "restricted"                                                                                                                                                                                                                               |
| Buy (SOL)       | `config.buysPaused == false`; `curve.complete == false`; `now >= curve.saleStartTs` (show a countdown during the 24 h cool-down); `remainingSpend(config, spend)` is `null` or `>= lamportsIn` (show the monthly cap left); buyer SOL >= amount + 0.004 SOL on the first buy           |
| Buy (USDC)      | as above with the SOL equivalent; buyer USDC ATA exists and balance >= `usdc_in`; in `price_mode 1`, warn if the Pyth `publish_time` is older than `config.maxPriceAgeSecs` or `conf > 2%` of `price`; in `price_mode 0`, warn if `now - config.priceUpdatedTs > adminPriceMaxAgeSecs` |
| Redeem (tokens) | `config.redeemsPaused == false`; `perk.active`; `artist.active`; `perk.maxSupply == 0 \|\| perk.sold < perk.maxSupply`; `now >= perk.publicStartTs`; token balance >= `perk.priceTokens`; SOL >= 0.01 for rent and fees (`redeemEligibility`)                                          |
| Buy perk (SOL)  | the redeem checks plus the buy checks on the curve (the curve leg is a buy): `config.buysPaused == false`, curve open, cap left >= `priceLamports / 2`; SOL >= `priceLamports` + 0.01                                                                                                  |

## 10. Error codes

Anchor returns custom errors as `6000 + index`. Map them to UI copy (`ERROR_COPY` in `@mostro/shared`). **Every code changed in this version.**

| Code | Name                    | Message                                                      | Typical cause in the UI                                                                                       |
| ---- | ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| 6000 | `BuysPaused`            | Curve buys are paused                                        | Circuit breaker on buys (also blocks hybrid perks)                                                            |
| 6001 | `RedeemsPaused`         | Perk redemptions are paused                                  | Circuit breaker on redeems                                                                                    |
| 6002 | `Unauthorized`          | Signer is not authorized                                     | Wrong signer on an admin/artist instruction; an artist creating a `Pass` perk                                 |
| 6003 | `SaleNotStarted`        | Sale has not started yet                                     | Curve still in its launch cool-down, or perk `public_start_ts` in the future                                  |
| 6004 | `PerkInactive`          | Perk is inactive                                             | Perk deactivated with `set_perk`                                                                              |
| 6005 | `PerkSoldOut`           | Perk is sold out                                             | `sold == max_supply`                                                                                          |
| 6006 | `SlippageExceeded`      | Slippage limit exceeded                                      | Price moved past `min_tokens_out` / `max_lamports_in`, or the perk price exceeded `max_paid` / `max_lamports` |
| 6007 | `CurveSoldOut`          | Curve supply cap reached                                     | Buy would exceed the 280M allocation; lower the amount                                                        |
| 6008 | `CurveComplete`         | Curve is complete; the primary market is closed              | Allocation sold out; buys and hybrid perks are closed                                                         |
| 6009 | `InsufficientReserves`  | Insufficient balance in the source vault                     | Hybrid perk needs more than `artist_reserve` holds; a governance transfer larger than the vault               |
| 6010 | `MathOverflow`          | Arithmetic overflow                                          | Absurd amounts                                                                                                |
| 6011 | `InvalidAmount`         | Invalid amount                                               | Zero or 1-lamport buys; zero-amount proposals                                                                 |
| 6012 | `InvalidBps`            | Invalid basis points                                         | Admin args                                                                                                    |
| 6013 | `InvalidTier`           | Invalid tier                                                 | Admin / artist args                                                                                           |
| 6014 | `InvalidCurveParams`    | Invalid curve parameters                                     | Admin args (`virtual_token_reserves` must exceed 280M)                                                        |
| 6015 | `StringTooLong`         | String too long                                              | name > 32, symbol > 10, uri > 200 bytes                                                                       |
| 6016 | `InvalidPriceAccount`   | Price account does not match config                          | Wrong `price_update` account in `price_mode 1`                                                                |
| 6017 | `PriceFeedMismatch`     | Price feed id mismatch                                       | Pyth account for another feed                                                                                 |
| 6018 | `PriceTooOld`           | Price is too old                                             | Pyth update or admin price older than the allowed age                                                         |
| 6019 | `PriceNonPositive`      | Price is not positive                                        | Pyth price <= 0                                                                                               |
| 6020 | `PriceNotSet`           | Price not set                                                | `price_mode 0` with `sol_usd_price_e6 == 0`                                                                   |
| 6021 | `PriceUncertain`        | Price confidence interval too wide                           | Pyth `conf` above 2% of `price`; retry shortly                                                                |
| 6022 | `AdminTransferNotReady` | Admin transfer not ready                                     | Cool-off not elapsed                                                                                          |
| 6023 | `NoPendingAdmin`        | No pending admin transfer                                    |                                                                                                               |
| 6024 | `InvalidCollection`     | Collection does not match perk                               | Wrong `collection` account                                                                                    |
| 6025 | `InvalidMint`           | Mint does not match                                          | Wrong `mint` / `usdc_mint`, or a curve that is not the artist's                                               |
| 6026 | `AlreadyFulfilled`      | Receipt already fulfilled                                    |                                                                                                               |
| 6027 | `ArtistInactive`        | Artist is inactive                                           |                                                                                                               |
| 6028 | `Blacklisted`           | Wallet is blacklisted                                        | Admin blocked the wallet                                                                                      |
| 6029 | `SpendCapExceeded`      | Monthly SOL spend cap exceeded for this artist               | The buy would push the wallet past `config.max_spend_per_period_lamports` on this curve                       |
| 6030 | `ArtistHasCurve`        | Artist already has a token                                   | Admin args                                                                                                    |
| 6031 | `InvalidPerkPrice`      | Perk must be priced in tokens or in SOL, not both or neither | Artist args                                                                                                   |
| 6032 | `WrongPerkPayment`      | Perk is not payable with this instruction                    | `redeem_perk` on a SOL-priced perk, or `buy_perk_sol` on a token-priced one                                   |
| 6033 | `NotAMember`            | Signer is not a governance member                            | Removed member (a wallet that never was one fails earlier with Anchor 3012)                                   |
| 6034 | `InvalidRole`           | Invalid member role                                          | Governance args                                                                                               |
| 6035 | `LastMember`            | Cannot remove the last voting weight                         | Governance                                                                                                    |
| 6036 | `InvalidProposalKind`   | Invalid proposal kind                                        | Governance args                                                                                               |
| 6037 | `InvalidVault`          | Invalid vault for this proposal                              | Vault kind / curve mismatch at creation, or the wrong `execute_*` for the vault                               |
| 6038 | `ProposalClosed`        | Proposal is executed or cancelled                            |                                                                                                               |
| 6039 | `ProposalExpired`       | Proposal has expired                                         | Past `proposal.expires_ts`                                                                                    |
| 6040 | `ThresholdNotMet`       | Proposal has not reached the approval threshold              | `approved_weight * 100 <= total_weight * 51`                                                                  |
| 6041 | `ProposalMismatch`      | Account does not match the proposal                          | Wrong source / destination / curve for the proposal                                                           |

Common Anchor framework errors: `2006` seeds constraint violated (a wrong PDA, including someone else's `blacklist_entry`), `3012` account not initialized (a missing `buyer_ata` on redeem; a non-member calling governance), `2003` raw constraint violated (`has_one` or custom constraint), `2001` constraint has one, and the system program's "already in use" when a member approves a proposal twice.

## 11. What the frontend owes the program side

| Item                                                                                    | Why                                                                                                       | When                               |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| The Openfort demo wallet address                                                        | To fund it with devnet SOL and USDC before recording                                                      | Before the seed script runs        |
| The initial member wallets (admins / super-admins) for devnet                           | Appointed through proposals by the seed wallet after the deploy                                           | Before the governance console demo |
| A Helius devnet API key                                                                 | DAS reads (`getAssetsByOwner`, `getTokenAccounts`) and the send RPC                                       | Before DAS integration             |
| Collection and perk images plus metadata JSON (https URIs, max 200 bytes) for each perk | `create_perk` writes `uri` into the perk, the collection and every asset. `set_perk` can replace it later | Before perks are created on devnet |
| The pass benefit rules (discount %, early access, VIP areas)                            | They are enforced by the web app now, from the pass asset the wallet holds                                | Before the perk pages              |

## 12. What changed from the previous version (migration notes)

| Area           | Before                                                                              | Now                                                                                                                  |
| -------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Sell           | `sell_tokens`                                                                       | removed; buy-only curve                                                                                              |
| Supply         | minted on demand up to `supply_cap`                                                 | fixed 1B minted in `create_curve`; buys transfer from `curve_vault`; `mint.mintAuthority == null`                    |
| Buys           | `kyc` optional account                                                              | `curve_vault`, `spend`, `blacklist_entry` accounts; monthly cap                                                      |
| KYC            | `Kyc` PDA, `kyc_required` flag, `set_kyc`                                           | `Blacklist` PDA, `set_blacklist`; everyone allowed by default                                                        |
| Pause          | `config.paused`                                                                     | `buys_paused` + `redeems_paused`; `emergency_pause` by any member                                                    |
| Perk price     | `price` + `burn_bps` / `rewards_bps` + floors                                       | `price_tokens` xor `price_lamports`; split fixed 80 / 20                                                             |
| Pass benefits  | `discount_eligible`, `vip_only`, `pass_asset` / `pass_perk`, config discount fields | gone; the web app applies benefits from the pass asset                                                               |
| Hybrid perks   | none                                                                                | `buy_perk_sol`                                                                                                       |
| Artist revenue | token share in `artist_vault`, `withdraw_artist_vault`                              | SOL paid directly to `artist.authority` on hybrid perks (`artist.revenue_lamports`)                                  |
| Treasury       | `withdraw_treasury_sol` / `_usdc` by the admin                                      | governance proposals only                                                                                            |
| Curve          | `create_curve` + `set_curve_metadata`                                               | one instruction, needs `artist`; `artist.curve` links them; `supply_cap` is fixed                                    |
| Receipt        | `paid`, `discount_bps`, `pass_used`, `to_artist`                                    | `paid_tokens`, `paid_lamports`, `tokens_from_curve`, `tokens_from_artist`, `lamports_to_curve`, `lamports_to_artist` |
| Errors         | 6000..6031                                                                          | 6000..6041, renumbered                                                                                               |
| Curve params   | VT0 1,000,000 tokens, cap 800,000                                                   | VT0 379,000,000 tokens, cap 280,000,000 (prices per token are ~400x lower; perk prices scale accordingly)            |

Instruction names, argument order and account order are append-only after the devnet deploy that ships with this document. A breaking change bumps `programVersion` in `shared/addresses/devnet.json` and is announced in the team channel.
