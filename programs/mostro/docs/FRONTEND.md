# Frontend handoff: the `mostro` program

Reader: a frontend developer who builds and signs transactions against the `mostro` Solana program. After reading, you can derive every address, build every user instruction, read every account, and know how much SOL and USDC each flow costs.

The code is the source of truth. When this document and the program disagree, the program wins; open an issue.

## 1. Identifiers

| Item                                 | Value                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Program id (localnet and devnet)     | `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`                                                       |
| Anchor version                       | 0.32.1                                                                                               |
| IDL                                  | `target/idl/mostro.json` (copied to `shared/idl/mostro.json` on each deploy)                         |
| TypeScript type                      | `target/types/mostro.ts`, exported type `Mostro` (copied to `shared/types/mostro.ts`)                |
| Addresses per cluster                | `shared/addresses/devnet.json`                                                                       |
| $MOST decimals                       | 6 (`1 $MOST = 1_000_000` base units)                                                                 |
| Devnet USDC mint                     | `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (6 decimals, Tokenkeg)                                |
| Metaplex Core program                | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`                                                       |
| Metaplex Token Metadata program      | `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s` (curve mint metadata, created by `set_curve_metadata`) |
| Pyth SOL/USD `PriceUpdateV2` account | `7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`                                                       |
| Pyth SOL/USD feed id                 | `ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d`                                   |
| Pyth receiver program                | `rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ`                                                        |

Import addresses from `shared/addresses/devnet.json`. Do not copy constants by hand into the apps. The program id is the only value that is safe to hardcode, because the PDAs below derive from it.

### Devnet state you must know before the first transaction

| Setting                           | Devnet value (since the slot 509182643 upgrade)                                                                                                   | What it means for the app                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config.kyc_required`             | `true`                                                                                                                                            | **Every wallet must be KYC-approved before it can buy or sell `$MOST`.** Run `npx ts-node scripts/set-kyc.ts <wallet> true GB` (admin wallet) for each demo / test wallet, then pass its `["kyc", wallet]` PDA (`kyc: true` in the SDK builders). Without it, buys and sells fail with `KycRequired` (6024). Redeems are not gated. The admin wallet is already approved ([tx](https://explorer.solana.com/tx/3mBnJaChREcNePh4GGKQeXcv8cwJUqeJu2D9pZdDpLsHoHWzJcpvAgV7jqujs6AbmzoEWCoXF1au3VCq4YXfGrwx?cluster=devnet)) |
| `config.admin_price_max_age_secs` | `86_400` (24 h)                                                                                                                                   | In price mode 0 the admin SOL/USD price expires after this; USDC buys then fail with `PriceTooOld` until the admin refreshes it (`scripts/set-price.ts 0 <priceUsd>` or `scripts/set-config.ts solUsdPriceE6=...`)                                                                                                                                                                                                                                                                                                      |
| `config.max_price_age_secs`       | `300`                                                                                                                                             | Pyth (mode 1) staleness limit; unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| On-chain IDL                      | upgraded                                                                                                                                          | Explorers decode every instruction, including `redeem_perk(nonce, max_paid)`                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Program                           | [`6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`](https://explorer.solana.com/address/6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK?cluster=devnet) | `.so` 731,640 bytes of 800,000 reserved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Reference transactions on devnet: [first redeem with the 5% pass discount](https://explorer.solana.com/tx/3gAt6NB9cNwr8bf3UpoqMmens4vzYu3AocQAHTsbT5csRBqH6GvgEhCApTdp2u1yBf7VcUsWX9KX6BX3Hq5AAH6o?cluster=devnet), [pass asset](https://explorer.solana.com/address/8V69nDgc24kERDDyMLQgeGAjNttxUa4KZBwJLXT83q6m?cluster=devnet), [sponsored redeem by a wallet holding 0 SOL](https://explorer.solana.com/tx/4kb1hVAH1dPvM8dBrB2ZumCddM62aSe46mkS7X51cqfCSeh8QDP9Xz5RSRGbY9bDtUq2cs5TLhQ1fbFgyDnbTBZJ?cluster=devnet) (fan `BENZutuN6MDtLHCYVagZtMWqdr4YncyYcZ92oMJo8sfQ`, asset [`6Y93pRA2N2WferK9iw1t7CDUoWjpmTrDMwUVUZ9NC49c`](https://explorer.solana.com/address/6Y93pRA2N2WferK9iw1t7CDUoWjpmTrDMwUVUZ9NC49c?cluster=devnet)).

### Terminology

| Concept                                      | Term used in this document | Not used            |
| -------------------------------------------- | -------------------------- | ------------------- |
| The SPL token sold on the bonding curve      | `$MOST` or "token"         | coin, points        |
| A `Perk` account (pass, music, event, merch) | perk                       | tier, product, drop |
| A MoOG Pass Metaplex Core asset              | pass                       | NFT, membership     |
| The Metaplex Core account minted on redeem   | asset                      | NFT                 |
| `redeem_perk`                                | redeem                     | buy perk, purchase  |
| `buy_tokens_*` / `sell_tokens`               | buy / sell                 | swap, trade         |
| The wallet that signs a user instruction     | buyer (or seller)          | user, customer      |
| The signer that pays rent and Core fees      | payer (defaults to buyer)  | sponsor, relayer    |

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

Account names in TypeScript are camelCase versions of the IDL names: `buyer_ata` becomes `buyerAta`, `mpl_core_program` becomes `mplCoreProgram`. Argument names follow the same rule.

Use `.accountsStrict({...})` and pass every account. Automatic resolution works for most PDAs, but strict mode makes the transaction deterministic and avoids extra RPC fetches for `has_one` relations.

### The `@mostro/shared` package

The `shared` workspace package wraps everything in this document. Prefer it over hand-written derivations; the sections below explain what it does so you can debug it.

| Need           | Export from `@mostro/shared`                                                                                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program handle | `createReadonlyProgram(connection)`, `createProgram(connection, wallet)`                                                                                                                                  |
| PDAs           | `configPda()`, `curvePda(i)`, `mintPda(i)`, `artistPda(j)`, `perkPda(artist, k)`, `assetPda(perk, nonce)`, `receiptPda(asset)`, `kycPda(wallet)`, `deriveCurveAddresses(i)`, `derivePerkAddresses(j, k)`  |
| Quotes         | `quoteBuyExactIn`, `quoteBuyExactOut`, `quoteSell`, `spotPrice`, `marketCap`, `progressToGraduationBps`, `minOut`, `maxIn`                                                                                |
| SOL/USD        | `solUsdFromConfig(config, pythAccountData?)`, `decodePriceUpdateV2`, `usdE6ToLamports`                                                                                                                    |
| Instructions   | `buildBuyTokensSol`, `buildBuyTokensExactOutSol`, `buildBuyTokensUsdc`, `buildSellTokens`, `buildRedeemPerk`, `randomNonce()`; artist side: `buildCreatePerk`, `buildSetPerk`, `buildWithdrawArtistVault` |
| Reads          | `fetchConfig`, `fetchCurve`, `fetchPerk`, `listPerks`, `listReceiptsByBuyer`, `fetchKyc`, `redeemEligibility`, `checkPerkSplit`, `canCreatePerk`                                                          |
| Passes         | `findPassForBuyer(connection, buyer, passPerks)`, `toPassAccounts(pass)`                                                                                                                                  |
| Holders        | `topHolders(connection, mint, exclude)`                                                                                                                                                                   |
| Errors         | `MOSTRO_ERRORS_BY_CODE`, `ERROR_COPY`                                                                                                                                                                     |

Each `build*` function returns `{ instruction, derived }`, where `derived` holds every address it resolved (for `buildRedeemPerk`: `asset`, `receipt`, `nonce`, `payer`). Every buy and redeem builder accepts an optional `payer`; omit it and the buyer pays its own rent (one signer). Pass a sponsor key to build a gas-sponsored instruction (two signers; see 4.2).

`shared/addresses/devnet.json` is written by `yarn seed:devnet` after the devnet seed; `yarn export:shared` refreshes `shared/idl` and `shared/types` from `target/`.

## 3. PDA seed table

All PDAs derive from the program id. Integers are little-endian. `u32` means 4 bytes, `u64` means 8 bytes.

| Account         | Seeds                                        | Owner / type                                                                                       |
| --------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `config`        | `["config"]`                                 | program, `Config`                                                                                  |
| `treasury`      | `["treasury"]`                               | System program (holds SOL fees)                                                                    |
| `treasury_usdc` | ATA(owner = `config`, mint = USDC)           | Token program                                                                                      |
| `curve`         | `["curve", curve_index: u32]`                | program, `Curve`                                                                                   |
| `mint`          | `["mint", curve_index: u32]`                 | Token program (mint authority = `curve`)                                                           |
| `sol_vault`     | `["sol_vault", curve]`                       | System program (real SOL reserves)                                                                 |
| `rewards_vault` | `["rewards", curve]`                         | Token account (mint = `mint`, authority = `curve`)                                                 |
| `usdc_vault`    | ATA(owner = `curve`, mint = USDC)            | Token program                                                                                      |
| `artist`        | `["artist", artist_index: u32]`              | program, `Artist`                                                                                  |
| `artist_vault`  | `["artist_vault", artist, mint]`             | Token account (authority = `artist`)                                                               |
| `perk`          | `["perk", artist, perk_index: u32]`          | program, `Perk`                                                                                    |
| `collection`    | `["collection", perk, collection_salt: u64]` | Metaplex Core `BaseCollectionV1` (salt = `CreatePerkArgs.collection_salt`; read `perk.collection`) |
| `asset`         | `["asset", perk, nonce: u64]`                | Metaplex Core `BaseAssetV1`                                                                        |
| `receipt`       | `["receipt", asset]`                         | program, `Receipt`                                                                                 |
| `kyc`           | `["kyc", wallet]`                            | program, `Kyc`                                                                                     |

`$MOST` is curve index 0. Derived devnet values for curve 0 (deterministic, listed for cross-checking):

| PDA               | Address                                        |
| ----------------- | ---------------------------------------------- |
| `config`          | `CfKmxY8e14VNMGL4P2XTNyjst2ZnvWKn9At3vu1nVkNE` |
| `treasury`        | `DRNx1WCLCc9xK3CcrdisBm4fhM8VVGFpoQg4rAUGRuXU` |
| `curve` (index 0) | `5nhi4zryhrajh7qVdD9ZTFbcqaq3tHnLYVizW4wzt5WZ` |
| `mint` (index 0)  | `XKfjX1yBTSP1tLovvtaPENeiqUhu8HUrxnC6bieLvtc`  |

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
const solVault = pda([Buffer.from("sol_vault"), curve.toBuffer()]);
const rewardsVault = pda([Buffer.from("rewards"), curve.toBuffer()]);
const artist = pda([Buffer.from("artist"), u32le(artistIndex)]);
const artistVault = pda([Buffer.from("artist_vault"), artist.toBuffer(), mint.toBuffer()]);
const perk = pda([Buffer.from("perk"), artist.toBuffer(), u32le(perkIndex)]);
const collection = pda([Buffer.from("collection"), perk.toBuffer(), u64le(collectionSalt)]); // prefer perk.collection from the account
const asset = pda([Buffer.from("asset"), perk.toBuffer(), u64le(nonce)]);
const receipt = pda([Buffer.from("receipt"), asset.toBuffer()]);
const kyc = pda([Buffer.from("kyc"), buyer.toBuffer()]);
```

Associated token accounts use `getAssociatedTokenAddressSync(mint, owner, true, TOKEN_PROGRAM_ID)` from `@solana/spl-token`. Pass `allowOwnerOffCurve = true` when the owner is a PDA (`config`, `curve`).

## 4. Instructions

Accounts are listed in IDL order. `mut` = writable, `signer` = must sign, `optional` = may be `null`. Every user flow is signed by the buyer or seller. Buys and `redeem_perk` also list a `payer` signer first: in the normal case it is the same key as `buyer`, so the transaction still has one signer; a gas sponsor puts its own key there and co-signs (4.2). Admin and artist instructions are listed for completeness; the apps do not call them.

### 4.1 User instructions

#### `buy_tokens_sol(lamports_in: u64, min_tokens_out: u64)`

Buy `$MOST` with an exact amount of SOL. Fee is taken from `lamports_in`; the rest enters the curve. `buyer` pays the SOL; `payer` pays the ATA rent.

| #   | Account                    | Flags                                           |
| --- | -------------------------- | ----------------------------------------------- |
| 1   | `payer`                    | mut, signer (rent payer; normally `== buyer`)   |
| 2   | `buyer`                    | mut, signer                                     |
| 3   | `config`                   |                                                 |
| 4   | `curve`                    | mut                                             |
| 5   | `mint`                     | mut                                             |
| 6   | `sol_vault`                | mut                                             |
| 7   | `treasury`                 | mut                                             |
| 8   | `buyer_ata`                | mut (created if missing, `payer` pays the rent) |
| 9   | `kyc`                      | optional (see 4.5)                              |
| 10  | `token_program`            | `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`   |
| 11  | `associated_token_program` | `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`  |
| 12  | `system_program`           | `11111111111111111111111111111111`              |

#### `buy_tokens_exact_out_sol(tokens_out: u64, max_lamports_in: u64)`

Buy an exact number of tokens. The program charges `cost + fee` and fails with `SlippageExceeded` when that exceeds `max_lamports_in`. Same accounts as `buy_tokens_sol`.

#### `buy_tokens_usdc(usdc_in: u64, min_tokens_out: u64)`

Buy `$MOST` with USDC. The program converts `usdc_in` to a SOL equivalent at the configured SOL/USD price and applies it to the SOL-quoted curve. USDC stays in the curve's `usdc_vault`.

| #   | Account                    | Flags                                                                                |
| --- | -------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `payer`                    | mut, signer (rent payer; normally `== buyer`)                                        |
| 2   | `buyer`                    | signer (owns the USDC, receives the tokens)                                          |
| 3   | `config`                   |                                                                                      |
| 4   | `curve`                    | mut                                                                                  |
| 5   | `mint`                     | mut                                                                                  |
| 6   | `usdc_mint`                | must equal `config.usdc_mint`                                                        |
| 7   | `buyer_usdc`               | mut, buyer's USDC token account (must exist)                                         |
| 8   | `usdc_vault`               | mut, ATA(`curve`, USDC)                                                              |
| 9   | `treasury_usdc`            | mut, ATA(`config`, USDC)                                                             |
| 10  | `buyer_ata`                | mut (created if missing, `payer` pays the rent)                                      |
| 11  | `price_update`             | Pyth `PriceUpdateV2` account; always passed, only read when `config.price_mode == 1` |
| 12  | `kyc`                      | optional (see 4.5)                                                                   |
| 13  | `token_program`            | Tokenkeg                                                                             |
| 14  | `usdc_token_program`       | Tokenkeg                                                                             |
| 15  | `associated_token_program` |                                                                                      |
| 16  | `system_program`           |                                                                                      |

#### `sell_tokens(tokens_in: u64, min_lamports_out: u64)`

Burn `tokens_in` and receive SOL from `sol_vault`. Fails with `InsufficientReserves` when the gross payout exceeds `curve.real_sol_reserves` (USDC buys do not add to SOL reserves; see ARCHITECTURE.md). Sells create no accounts, so there is no `payer`; the KYC gate applies exactly as on buys.

| #   | Account          | Flags              |
| --- | ---------------- | ------------------ |
| 1   | `seller`         | mut, signer        |
| 2   | `config`         |                    |
| 3   | `curve`          | mut                |
| 4   | `mint`           | mut                |
| 5   | `sol_vault`      | mut                |
| 6   | `treasury`       | mut                |
| 7   | `seller_ata`     | mut                |
| 8   | `kyc`            | optional (see 4.5) |
| 9   | `token_program`  |                    |
| 10  | `system_program` |                    |

#### `redeem_perk(nonce: u64, max_paid: u64)`

Pay `perk.price` in `$MOST` (minus any pass discount), burn and route the split, mint a Metaplex Core asset into the perk's collection for the buyer, and write a `Receipt`. `buyer` spends the tokens and receives the asset; `payer` pays the receipt rent, the asset rent and the Metaplex Core protocol fee.

| #   | Account            | Flags                                                           |
| --- | ------------------ | --------------------------------------------------------------- |
| 1   | `payer`            | mut, signer (rent + Core fee payer; normally `== buyer`)        |
| 2   | `buyer`            | signer                                                          |
| 3   | `config`           |                                                                 |
| 4   | `artist`           | mut, `perk.artist`                                              |
| 5   | `perk`             | mut                                                             |
| 6   | `curve`            | mut, the curve whose `mint == perk.mint`                        |
| 7   | `mint`             | mut, `perk.mint`                                                |
| 8   | `buyer_ata`        | mut, buyer's `$MOST` token account (must exist and hold enough) |
| 9   | `rewards_vault`    | mut, `["rewards", curve]`                                       |
| 10  | `artist_vault`     | mut, `["artist_vault", artist, mint]`                           |
| 11  | `collection`       | mut, `perk.collection`                                          |
| 12  | `asset`            | mut, `["asset", perk, nonce]`                                   |
| 13  | `receipt`          | mut, `["receipt", asset]`                                       |
| 14  | `pass_asset`       | optional, a pass the buyer owns                                 |
| 15  | `pass_perk`        | optional, the `Perk` the pass was minted from                   |
| 16  | `mpl_core_program` | `CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`                  |
| 17  | `token_program`    |                                                                 |
| 18  | `system_program`   |                                                                 |

`nonce` is a random `u64` generated by the client. It only exists to make `asset` unique. Two buyers in the same slot never collide, and the client knows the asset address before the transaction confirms. If a nonce was already used for this perk, Core fails because the asset account exists; retry with a new nonce.

```ts
const nonce = new BN(crypto.getRandomValues(new Uint8Array(8)), "le");
```

`max_paid` caps what the buyer pays. The program computes `paid = price - discount` (4.3) and fails with `SlippageExceeded` (6005) when `paid > max_paid`, so a `set_perk` price change between the quote and the confirmation cannot overcharge. The price is deterministic for a given perk / config / pass state: pass exactly the expected amount (`expectedPaid(config, perk, passTier).paid` in `@mostro/shared`, or `prepareRedeemPerk` which fills it in), no margin. `collection` is `perk.collection` from the fetched account; its PDA is salted (`["collection", perk, collection_salt]`) and the salt is not stored on-chain, so do not re-derive it unless you know the salt (the devnet seed uses `1`, recorded as `collectionSalt` in `shared/addresses/devnet.json`).

### 4.2 The `payer` account (gas sponsorship)

`buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc` and `redeem_perk` take a `payer` signer before `buyer`. The program charges `payer` for every account it creates (`buyer_ata` on the first buy, `receipt` and the Core `asset` on redeem) and for the Metaplex Core protocol fee. It never charges `payer` for the trade itself: the SOL, USDC or `$MOST` always comes from `buyer`, and the tokens and the asset always go to `buyer`.

| Case                         | `payer`                  | Signers           | Transaction `feePayer` |
| ---------------------------- | ------------------------ | ----------------- | ---------------------- |
| Self-paid (default)          | the buyer's key          | buyer             | buyer                  |
| Sponsored (Openfort or Kora) | the sponsor's funded key | buyer and sponsor | the sponsor            |

How a sponsor uses it: the app builds the instruction with `payer = sponsor`, sets the transaction fee payer to the same sponsor key, has the buyer sign, then sends the partially signed transaction to the sponsor (Kora's `signAndSendTransaction`, or Openfort's gas policy on the embedded wallet). The sponsor inspects the instruction, co-signs and broadcasts. The on-chain check is only "`payer` signed", so the sponsor must inspect what it co-signs: any other instruction in the same transaction could spend its SOL. With `@mostro/shared`, pass `payer: sponsorKey` to the builders; `derived.payer` echoes what was encoded. `sell_tokens` creates no accounts and has no `payer`.

### 4.3 The optional pass accounts of `redeem_perk`

`pass_asset` and `pass_perk` go together: pass both or neither. Anchor encodes `null` as the program id; the program treats that as "no pass".

| Situation                                        | `pass_asset`           | `pass_perk`                    |
| ------------------------------------------------ | ---------------------- | ------------------------------ |
| Buyer has no pass, or redeems a Pass perk itself | `null`                 | `null`                         |
| Buyer has a Standard or VIP pass                 | the Core asset address | the `Perk` the pass belongs to |

The program checks on-chain: `pass_perk.kind == Pass`, `pass_asset.owner == buyer`, and `pass_asset.update_authority == Collection(pass_perk.collection)`. A pass that was transferred away fails with `InvalidPass`. Pass benefits follow the current owner of the asset.

What a valid pass changes (values live in `Config`, defaults in parentheses):

| Pass tier           | Discount (when `perk.discount_eligible`) | Early access before `perk.public_start_ts` | VIP-only perks |
| ------------------- | ---------------------------------------- | ------------------------------------------ | -------------- |
| Standard (`tier 0`) | `standard_discount_bps` (500 = 5%)       | `standard_early_secs` (86,400 = 24 h)      | no             |
| VIP (`tier 1`)      | `vip_discount_bps` (1,500 = 15%)         | `vip_early_secs` (259,200 = 72 h)          | yes            |

Pick the best pass the buyer owns (VIP over Standard) and pass it even when the perk gives no discount: it may unlock early access.

Amount actually paid: `paid = price - floor(price * discount_bps / 10_000)`. The split: `burned = floor(paid * burn_bps / 10_000)`, `to_rewards = floor(paid * rewards_bps / 10_000)`, `to_artist = paid - burned - to_rewards`. `burn_bps` and `rewards_bps` live in the `Perk` account (default 8,000 / 2,000, so the artist share is 0 unless the perk says otherwise). The protocol enforces floors on both: `burn_bps >= config.min_burn_bps` and `rewards_bps >= config.min_rewards_bps` (0 / 0 on devnet), checked in `create_perk` and `set_perk`.

### 4.4 Admin and artist instructions (reference)

| Instruction              | Args                                               | Signer                                                                      | Accounts in order                                                                                                                                                                                                                                     |
| ------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `initialize_config`      | `args: InitializeConfigArgs`                       | program upgrade authority                                                   | `payer`, `config`, `treasury`, `usdc_mint`, `treasury_usdc`, `program`, `program_data`, `usdc_token_program`, `associated_token_program`, `system_program`                                                                                            |
| `set_config`             | `args: SetConfigArgs` (all fields `Option`)        | admin                                                                       | `admin`, `config`                                                                                                                                                                                                                                     |
| `propose_admin`          | `new_admin: Pubkey`                                | admin                                                                       | `admin`, `config`                                                                                                                                                                                                                                     |
| `cancel_admin_transfer`  |                                                    | admin                                                                       | `admin`, `config`                                                                                                                                                                                                                                     |
| `accept_admin`           |                                                    | pending admin                                                               | `pending_admin`, `config`                                                                                                                                                                                                                             |
| `set_kyc`                | `wallet: Pubkey, approved: bool, country: [u8; 2]` | admin                                                                       | `admin`, `config`, `kyc`, `system_program`                                                                                                                                                                                                            |
| `withdraw_treasury_sol`  | `amount: u64`                                      | admin                                                                       | `admin`, `config`, `treasury`, `destination`, `system_program`                                                                                                                                                                                        |
| `withdraw_treasury_usdc` | `amount: u64`                                      | admin                                                                       | `admin`, `config`, `usdc_mint`, `treasury_usdc`, `destination`, `usdc_token_program`                                                                                                                                                                  |
| `create_curve`           | `args: CreateCurveArgs`                            | admin                                                                       | `admin`, `config`, `curve`, `mint`, `sol_vault`, `rewards_vault`, `usdc_mint`, `usdc_vault`, `token_program`, `usdc_token_program`, `associated_token_program`, `system_program`                                                                      |
| `set_curve_metadata`     |                                                    | admin                                                                       | `admin`, `config`, `curve`, `mint`, `metadata` (`["metadata", token_metadata_program, mint]` under `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`), `token_metadata_program`, `system_program`, `rent` (`SysvarRent111111111111111111111111111111111`) |
| `create_artist`          | `authority: Pubkey, name: String, uri: String`     | admin                                                                       | `admin`, `config`, `artist`, `system_program`                                                                                                                                                                                                         |
| `set_artist`             | `args: SetArtistArgs`                              | artist authority or admin; `authority` field: current artist authority only | `signer`, `config`, `artist`                                                                                                                                                                                                                          |
| `withdraw_artist_vault`  | `amount: u64`                                      | artist authority only                                                       | `authority`, `artist`, `mint`, `artist_vault`, `destination`, `token_program`                                                                                                                                                                         |
| `create_perk`            | `args: CreatePerkArgs`                             | artist authority or admin; `kind: Pass` admin only                          | `signer`, `config`, `artist`, `curve`, `mint`, `perk`, `collection`, `artist_vault`, `mpl_core_program`, `token_program`, `system_program`                                                                                                            |
| `set_perk`               | `args: SetPerkArgs`                                | artist authority or admin; Pass perks: admin only                           | `signer`, `config`, `artist`, `perk`                                                                                                                                                                                                                  |
| `fulfill_receipt`        |                                                    | artist authority or admin                                                   | `signer`, `config`, `artist`, `receipt`                                                                                                                                                                                                               |

`set_curve_metadata` creates the Metaplex Token Metadata account of a curve mint from `curve.name` / `curve.symbol` / `curve.uri`, with the `curve` PDA as mint and update authority, so wallets show the symbol instead of "Unknown Token". It has no arguments and succeeds once per mint (the second call fails because the account exists). `metadataPda(mint)` in `@mostro/shared` derives the account; the devnet seed runs the instruction right after `create_curve`.

`withdraw_artist_vault` has a single allowed signer: `authority` must equal `artist.authority` (`has_one`), and the instruction does not even take `config`, so the protocol admin cannot move an artist's revenue. `create_perk` with `kind: Pass` requires `signer == config.admin`; an artist authority gets `Unauthorized` (6001). Every other kind accepts the artist authority or the admin.

Argument structs (field order matters for Borsh; Anchor's TS client serializes from the IDL):

- `InitializeConfigArgs { admin, fee_bps: u16, sol_usd_price_e6: u64, max_price_age_secs: u32, pyth_sol_usd_account, pyth_feed_id: [u8; 32], admin_cooloff_secs: u32, min_burn_bps: u16, min_rewards_bps: u16, admin_price_max_age_secs: u32 }`
- `SetConfigArgs { paused?, kyc_required?, price_mode?: u8, sol_usd_price_e6?, pyth_sol_usd_account?, pyth_feed_id?, max_price_age_secs?, fee_bps?, standard_discount_bps?, vip_discount_bps?, standard_early_secs?, vip_early_secs?, min_burn_bps?: u16, min_rewards_bps?: u16, admin_price_max_age_secs?: u32 }`
- `CreateCurveArgs { name, symbol, uri, virtual_sol_reserves: u64, virtual_token_reserves: u64, supply_cap: u64, sale_start_ts: i64 }`
- `CreatePerkArgs { kind: PerkKind, tier: u8, price: u64, burn_bps: u16, rewards_bps: u16, max_supply: u32, public_start_ts: i64, vip_only: bool, discount_eligible: bool, name, uri, collection_salt: u64 }`
- `SetPerkArgs { price?, active?, max_supply?, public_start_ts?, vip_only?, discount_eligible?, burn_bps?, rewards_bps?, uri? }`
- `SetArtistArgs { authority?, name?, uri?, active? }`. Setting `authority` hands the artist (and its vault) over, so only the current authority may do it; the admin can change `name`, `uri`, `active` only.

`PerkKind` in TypeScript is an object with one key: `{ pass: {} }`, `{ music: {} }`, `{ event: {} }`, `{ merch: {} }`. `tier` is `0` (Standard) or `1` (VIP) for `Pass` and must be `0` for every other kind.

Split floors: `create_perk` and `set_perk` fail with `InvalidBps` (6011) when `burn_bps + rewards_bps > 10_000`, `burn_bps < config.min_burn_bps` or `rewards_bps < config.min_rewards_bps`. `Config` stores the floors (`min_burn_bps`, `min_rewards_bps`; `_reserved` shrank from 64 to 60 bytes to make room, so the account size is unchanged). The devnet seed sets both to 0 and keeps the per-perk default of 8,000 / 2,000. An artist dashboard should read the floors from `Config` and validate with `checkPerkSplit(config, burnBps, rewardsBps)` before building the instruction.

### 4.5 The optional `kyc` account on buys and sells

`buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc` and `sell_tokens` take an optional `kyc` account. The gate is symmetric: when it is on, a wallet that cannot buy cannot sell either. The IDL declares `kyc` without PDA seeds, so Anchor clients never try to auto-resolve it: omit it (or pass `null`) when the gate is off; pass the wallet's `["kyc", wallet]` PDA when it is on (the program checks `kyc.wallet == buyer`).

| `config.kyc_required` | What to pass                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| `false`               | `null`                                                                                                   |
| `true`                | the `["kyc", buyer-or-seller]` PDA. It must exist and have `approved == true`, else `KycRequired` (6024) |

Do not pass the PDA when it does not exist: Anchor rejects an uninitialized account (error 3012 `AccountNotInitialized`). Fetch it first with `program.account.kyc.fetchNullable(kycPda)`. `redeem_perk` is not gated by KYC.

**On devnet the gate is on** (`kyc_required = true`). Before a new wallet can buy or sell, the admin approves it with `npx ts-node scripts/set-kyc.ts <wallet> true GB`; the app should show "verification pending" instead of the Buy / Sell buttons while `fetchKyc(program, wallet)` returns `null` or `approved == false`. Country is a 2-letter ISO code stored on-chain and not yet enforced. Only the attestation (approved flag, country, timestamp) is on-chain; no personal data.

## 5. Building and signing a transaction

```ts
import { ComputeBudgetProgram, SystemProgram, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";

const MPL_CORE = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// `payer` defaults to the buyer (self-paid, one signer). A sponsor passes its own key and co-signs (4.2).
async function buildRedeemTx(buyer: PublicKey, artistIndex: number, perkIndex: number, pass?: { asset: PublicKey; perk: PublicKey }, payer: PublicKey = buyer) {
   const nonce = new BN(crypto.getRandomValues(new Uint8Array(8)), "le");
   const artist = pda([Buffer.from("artist"), u32le(artistIndex)]);
   const perk = pda([Buffer.from("perk"), artist.toBuffer(), u32le(perkIndex)]);
   const perkState = await program.account.perk.fetch(perk);
   const mint = perkState.mint;
   const curve = pda([Buffer.from("curve"), u32le(0)]); // $MOST; for another mint, find the curve with curve.mint == perk.mint
   const asset = pda([Buffer.from("asset"), perk.toBuffer(), u64le(nonce)]);

   // What the buyer will pay; with a pass and perk.discount_eligible subtract floor(price * discount_bps / 10_000).
   const maxPaid = perkState.price;
   const ix = await program.methods
      .redeemPerk(nonce, maxPaid)
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
         artistVault: pda([Buffer.from("artist_vault"), artist.toBuffer(), mint.toBuffer()]),
         collection: perkState.collection,
         asset,
         receipt: pda([Buffer.from("receipt"), asset.toBuffer()]),
         passAsset: pass ? pass.asset : null,
         passPerk: pass ? pass.perk : null,
         mplCoreProgram: MPL_CORE,
         tokenProgram: TOKEN_PROGRAM_ID,
         systemProgram: SystemProgram.programId,
      })
      .instruction();

   const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 }), ix);
   tx.feePayer = payer;
   tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
   return { tx, derived: { asset, receipt: pda([Buffer.from("receipt"), asset.toBuffer()]), nonce } };
}
```

Self-paid: `wallet.signTransaction(tx)` and `connection.sendRawTransaction(signed.serialize(), { preflightCommitment: "confirmed" })`. Sponsored: the buyer signs first (`partialSign`), the sponsor adds its signature as `feePayer` and `payer`, then broadcasts. Apart from `payer`, no other signer exists in any user instruction: every PDA signs through the program.

For `@solana/kit` apps: convert the legacy instruction with `fromLegacyTransactionInstruction` from `@solana/compat`, then build a v0 message with the kit pipeline and the compute-budget instructions. The Openfort signer returns one ed25519 signature; if it returns 65 bytes, keep the first 64.

If the blockhash expires, rebuild with a new blockhash and the same nonce. If the first attempt did land, the retry fails cleanly because the asset account exists.

### Compute units

| Instruction                   | `setComputeUnitLimit`                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `redeem_perk`                 | `150_000` is enough: measured 109,290 CU total on devnet (program 108,990, of which Core `CreateV2` 25,116). `400_000` was the pre-measurement ceiling and still works, it only raises the priority-fee cost |
| `buy_tokens_*`, `sell_tokens` | default (200,000) is enough; set `100_000` to lower priority fee cost if you set a price                                                                                                                     |

Set `setComputeUnitPrice` to at least 1,000 microlamports on devnet when it is congested.

## 6. Money per flow

Rent on Solana clusters today is `(128 + account bytes) * 5,080` lamports (devnet and mainnet report the same value; the program never hardcodes it). The `redeem_perk` numbers below are measured from the devnet transaction [`3gAt6N…AAH6o`](https://explorer.solana.com/tx/3gAt6NB9cNwr8bf3UpoqMmens4vzYu3AocQAHTsbT5csRBqH6GvgEhCApTdp2u1yBf7VcUsWX9KX6BX3Hq5AAH6o?cluster=devnet); the buy numbers are rent arithmetic.

| Flow                       | `buyer` pays                    | Extra SOL `payer` needs (the buyer itself unless sponsored)                                       |
| -------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `buy_tokens_sol`           | `lamports_in` (fee included)    | ~0.0015 SOL rent for the `$MOST` ATA on the first buy (165 bytes = 1,488,440 lamports) + tx fee   |
| `buy_tokens_exact_out_sol` | `cost + fee <= max_lamports_in` | same as above                                                                                     |
| `buy_tokens_usdc`          | `usdc_in` USDC                  | ~0.0015 SOL ATA rent on the first buy + tx fee. The buyer's USDC token account must already exist |
| `sell_tokens`              | `tokens_in` `$MOST`             | tx fee only (no `payer`); the seller receives `net_out` SOL                                       |
| `redeem_perk`              | `paid` `$MOST`                  | 0.00544748 SOL measured (5,447,480 lamports), see the breakdown below                             |

`redeem_perk` cost breakdown, all charged to `payer`:

| Item                                          | Lamports      | Note                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Receipt` rent                                | 1,965,960     | 259 bytes, permanent (measured)                                                                                                                                                                                                                                                                                                                                           |
| Core asset: rent + Metaplex Core protocol fee | 3,476,120     | measured for a 4-attribute asset; the fee part is the fixed 0.0015 SOL Core charges per created asset, the rest is rent that varies with name / URI length                                                                                                                                                                                                                |
| Transaction fee                               | 5,400         | 5,000 base + 400 priority: `setComputeUnitPrice(1_000)` x the 400_000 CU **limit** requested in the section 5 example (the priority fee is charged on the requested limit, not on the ~109k consumed). With the recommended 150_000 limit it is 150 lamports, so the total below is specific to that example; the sponsor pays this too when the transaction is sponsored |
| **Total charged to `payer`**                  | **5,447,480** | 0.00544748 SOL                                                                                                                                                                                                                                                                                                                                                            |

The `treasury_usdc` and `usdc_vault` accounts exist from `initialize_config` and `create_curve`. No user pays protocol rent.

Perk prices on devnet (in `$MOST`, 6 decimals): Pass Standard 1,200 (`1_200_000_000`), Pass VIP 3,750 (`3_750_000_000`), Music from 50, Event from 900, Merch from 1,500. Read `perk.price` instead of hardcoding.

## 7. Quotes (match the on-chain integer math exactly)

All math is `u128` integer math with floor division unless stated. `VQ` = `curve.virtual_sol_reserves` (lamports), `VT` = `curve.virtual_token_reserves` (base units), `fee_bps` = `config.fee_bps`.

| Quote                                         | Formula                                                                                                                                             |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buy exact in (`buy_tokens_sol`)               | `net = (lamports_in - 1) * 10_000 / (10_000 + fee_bps)`; `fee = lamports_in - net`; `tokens_out = net * VT / (VQ + net)`                            |
| Buy exact out (`buy_tokens_exact_out_sol`)    | `cost = tokens_out * VQ / (VT - tokens_out) + 1`; `fee = ceil(cost * fee_bps / 10_000)`; total `= cost + fee`                                       |
| Sell (`sell_tokens`)                          | `gross = tokens_in * VQ / (VT + tokens_in)`; `fee = ceil(gross * fee_bps / 10_000)`; `net_out = gross - fee`; requires `gross <= real_sol_reserves` |
| Buy with USDC                                 | `lamports_equiv = usdc_in * 1e9 / sol_usd_price_e6`, then the buy-exact-in formula on `lamports_equiv`                                              |
| Spot price                                    | `VQ / VT` lamports per base unit; in SOL per whole token: `(VQ / 1e9) / (VT / 1e6)`                                                                 |
| Market cap                                    | spot price × live `mint.supply` (use live supply so burns are visible)                                                                              |
| Progress to completion                        | `curve.tokens_sold / curve.supply_cap`                                                                                                              |
| SOL needed to complete the curve from genesis | `VQ0 * VT0 / (VT0 - supply_cap) - VQ0` (derived, never stored)                                                                                      |

Slippage: default 1%, `min_tokens_out = tokens_out * 99 / 100`, `max_lamports_in = total * 101 / 100`.

`$MOST` curve parameters on devnet ("set B"): `virtual_sol_reserves = 30_000_000_000` (30 SOL), `virtual_token_reserves = 1_000_000_000_000` (1,000,000 tokens), `supply_cap = 800_000_000_000` (800,000 tokens), `fee_bps = 100`, `sale_start_ts = 0`. At genesis 0.1 SOL buys about 3,290 tokens; completing the curve takes 120 SOL of net buys.

SOL/USD price in `price_mode 0` is `config.sol_usd_price_e6` (USD with 6 decimals), valid while `now - config.price_updated_ts <= config.admin_price_max_age_secs` (86,400 s on devnet). In `price_mode 1` read the Pyth account: `price: i64` at byte 73, `exponent: i32` at 89, `publish_time: i64` at 93; `price_e6 = price * 10^(6 + exponent)`. The program rejects a price older than `config.max_price_age_secs`.

## 8. Read patterns (no backend)

### Single accounts

```ts
const config = await program.account.config.fetch(configPda);
const curve = await program.account.curve.fetch(curvePda);
const artist = await program.account.artist.fetch(artistPda);
const perk = await program.account.perk.fetch(perkPda);
const receipt = await program.account.receipt.fetchNullable(receiptPda);
const kyc = await program.account.kyc.fetchNullable(kycPda);
```

Enumerate artists with `config.artist_count` and perks with `artist.perk_count`; indexes are dense from 0. Or fetch everything of one type: `program.account.perk.all()`.

### Receipts of a buyer ("my perks")

`Receipt` layout: discriminator at 0 (8 bytes, base58 `7dCM6vBfCTz`), `bump` at 8, `version` at 9, `buyer` at 10, `perk` at 42, `artist` at 74, `asset` at 106.

```ts
const mine = await program.account.receipt.all([{ memcmp: { offset: 10, bytes: buyer.toBase58() } }]);
const forPerk = await program.account.receipt.all([{ memcmp: { offset: 42, bytes: perk.toBase58() } }]);
```

`program.account.receipt.all(filters)` adds the discriminator filter for you. A receipt records the original buyer; the asset may have moved since. For "what does this wallet hold now", use the asset owner (next section).

### Passes and perk assets of a wallet ("my passes")

Option A, Metaplex Core client (`@metaplex-foundation/mpl-core` + umi):

```ts
const assets = await fetchAssetsByOwner(umi, publicKey(owner));
const passes = assets.filter((a) => a.updateAuthority.type === "Collection" && a.updateAuthority.address === passPerk.collection.toBase58());
```

Option B, Helius DAS (`getAssetsByOwner`, or `searchAssets` with `grouping: ["collection", <collection>]`). Both return the on-chain attributes `kind`, `tier`, `artist`, `edition` that the program writes into the asset's `Attributes` plugin. There is no `perk` attribute: the perk is identified by the asset's collection (`update_authority = Collection(perk.collection)`), or by the `Receipt` at `["receipt", asset]`.

Each asset is named `"{perk.name} #{edition}"` and carries the perk's `uri`. The `Edition` plugin holds `edition`.

### Top holders

`connection.getTokenLargestAccounts(mint)` returns the 20 largest token accounts. Resolve owners with `connection.getMultipleParsedAccounts(addresses)` and read `parsed.info.owner`. Filter out `rewards_vault` and every `artist_vault`. For all holders use Helius DAS `getTokenAccounts({ mint })` and sort client-side.

### Live updates

`program.addEventListener("tokensBought", cb)` and `"tokensSold"`, `"perkRedeemed"`, `"receiptFulfilled"`; admin/artist side: `"perkCreated"`, `"perkUpdated"`, `"artistCreated"`, `"artistUpdated"`, `"artistVaultWithdrawn"`, `"treasuryWithdrawn"` (`{ destination, amount, usdc }`), `"configUpdated"`, `"adminProposed"`, `"adminAccepted"`, `"adminTransferCancelled"`, `"kycUpdated"`, `"curveCreated"`, `"configInitialized"` (17 events in total). Events carry the post-trade virtual reserves, so a price chart needs no extra fetch. Polling `curve` every few seconds is the fallback.

### Burn counter and rewards

`curve.total_burned` (from redeems), `curve.rewards_accrued`, `artist.revenue_tokens`, `perk.sold`.

## 9. Pre-flight checks before enabling a button

| Button                                                                                                                                                                                                                                                         | Check                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Any                                                                                                                                                                                                                                                            | `config.paused == false`, else show "paused"                                                                                                                                                                                                                                                                                                          |
| Buy (SOL)                                                                                                                                                                                                                                                      | buyer SOL >= amount + 0.003 SOL; `curve.complete == false`; `now >= curve.sale_start_ts`; if `config.kyc_required`, `kyc.approved == true`                                                                                                                                                                                                            |
| Buy (USDC)                                                                                                                                                                                                                                                     | buyer USDC ATA exists and balance >= `usdc_in`; buyer SOL >= 0.003; in `price_mode 1`, read the Pyth account and warn if `publish_time` is older than `config.max_price_age_secs` or `conf > 2%` of `price`; in `price_mode 0`, warn if `now - config.price_updated_ts > admin_price_max_age_secs` (24 h on devnet; the admin must refresh the price) |
| Sell                                                                                                                                                                                                                                                           | `gross <= curve.real_sol_reserves`, else show "not enough SOL reserves"; if `config.kyc_required`, `kyc.approved == true` (same gate as buys)                                                                                                                                                                                                         |
| \1 if presenting a pass, `pass_perk.active`; `perk.max_supply == 0 \|\| perk.sold < perk.max_supply`; `now >= perk.public_start_ts - early_secs` for the buyer's pass tier; if `perk.vip_only`, buyer holds a VIP pass; `$MOST` balance >= `paid`; SOL >= 0.01 |

On devnet `config.kyc_required` is `true`: the Buy and Sell checks above include "the wallet has an approved `Kyc`" for every wallet, not only when a flag says so. Check `fetchKyc(program, wallet)` at connect time and show the verification state in the UI.

## 10. Error codes

Anchor returns custom errors as `6000 + index`. Map them to UI copy.

| Code | Name                    | Message                                | Typical cause in the UI                                                                                                                             |
| ---- | ----------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6000 | `Paused`                | Protocol is paused                     | Admin paused trading and redeems                                                                                                                    |
| 6001 | `Unauthorized`          | Signer is not authorized               | Wrong signer on an admin/artist instruction; an artist creating a `Pass` perk; anyone but `artist.authority` withdrawing the artist vault           |
| 6002 | `SaleNotStarted`        | Sale has not started yet               | Curve `sale_start_ts` or perk `public_start_ts` (minus early access) is in the future                                                               |
| 6003 | `PerkInactive`          | Perk is inactive                       | Perk deactivated with `set_perk`, or the pass perk presented in `pass_perk` is inactive                                                             |
| 6004 | `PerkSoldOut`           | Perk is sold out                       | `sold == max_supply`                                                                                                                                |
| 6005 | `SlippageExceeded`      | Slippage limit exceeded                | Price moved past `min_tokens_out` / `max_lamports_in` / `min_lamports_out`, or the redeem price exceeded `max_paid`                                 |
| 6006 | `CurveSoldOut`          | Curve supply cap reached               | Buy would exceed `supply_cap`; lower the amount                                                                                                     |
| 6007 | `CurveComplete`         | Curve is complete; trading is closed   | Buys closed; sells still work                                                                                                                       |
| 6008 | `InsufficientReserves`  | Insufficient real reserves to pay out  | Sell larger than `real_sol_reserves`; admin `withdraw_treasury_sol` below the treasury rent floor                                                   |
| 6009 | `MathOverflow`          | Arithmetic overflow                    | Absurd amounts                                                                                                                                      |
| 6010 | `InvalidAmount`         | Invalid amount                         | Zero or 1-lamport buys, zero sells                                                                                                                  |
| 6011 | `InvalidBps`            | Invalid basis points                   | Perk split: `burn + rewards > 10_000`, or below `config.min_burn_bps` / `min_rewards_bps`; admin args                                               |
| 6012 | `InvalidTier`           | Invalid tier                           | Admin args                                                                                                                                          |
| 6013 | `InvalidCurveParams`    | Invalid curve parameters               | Admin args                                                                                                                                          |
| 6014 | `StringTooLong`         | String too long                        | name > 32, symbol > 10, uri > 200 bytes                                                                                                             |
| 6015 | `InvalidPriceAccount`   | Price account does not match config    | Wrong `price_update` account in `price_mode 1`                                                                                                      |
| 6016 | `PriceFeedMismatch`     | Price feed id mismatch                 | Pyth account for another feed                                                                                                                       |
| 6017 | `PriceTooOld`           | Price is too old                       | Pyth update older than `max_price_age_secs` (mode 1), or the admin price (`config.price_updated_ts`) older than `admin_price_max_age_secs` (mode 0) |
| 6018 | `PriceNonPositive`      | Price is not positive                  | Pyth price <= 0                                                                                                                                     |
| 6019 | `PriceNotSet`           | Price not set                          | `price_mode 0` with `sol_usd_price_e6 == 0`                                                                                                         |
| 6020 | `AdminTransferNotReady` | Admin transfer not ready               | Cool-off not elapsed                                                                                                                                |
| 6021 | `NoPendingAdmin`        | No pending admin transfer              |                                                                                                                                                     |
| 6022 | `InvalidCollection`     | Collection does not match perk         | Wrong `collection` account                                                                                                                          |
| 6023 | `InvalidMint`           | Mint does not match                    | Wrong `mint` or `usdc_mint`                                                                                                                         |
| 6024 | `KycRequired`           | KYC approval required                  | `kyc_required` and no approved `Kyc` for the buyer (buys) or seller (sells)                                                                         |
| 6025 | `VipOnly`               | Perk is VIP-only                       | Buyer has no VIP pass                                                                                                                               |
| 6026 | `InvalidPass`           | Pass asset is not valid for this buyer | Pass not owned by buyer, or not a collection asset                                                                                                  |
| 6027 | `PassMismatch`          | Pass perk and pass asset do not match  | Only one of the two pass accounts passed, pass from another collection, or `pass_perk` is not a Pass                                                |
| 6028 | `AlreadyFulfilled`      | Receipt already fulfilled              |                                                                                                                                                     |
| 6029 | `ArtistInactive`        | Artist is inactive                     |                                                                                                                                                     |
| \1   |
| 6031 | `PriceUncertain`        | Price confidence interval too wide     | Pyth `conf` above 2% of `price` in `price_mode 1`; retry shortly                                                                                    |

Common Anchor framework errors: `2006` seeds constraint violated (a wrong PDA), `3012` account not initialized (for example a `kyc` PDA passed when it does not exist, or a missing `buyer_ata` on redeem), `2003` raw constraint violated (`has_one` or custom constraint).

## 11. What the frontend owes the program side

| Item                                                                                                         | Why                                                                                                              | When                               |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Every wallet that will buy or sell on devnet (demo, QA, recording)                                           | `kyc_required` is on: the admin must run `scripts/set-kyc.ts <wallet> true GB` for each one before the first buy | Before each test session           |
| The Openfort demo wallet address                                                                             | To fund it with devnet SOL and USDC before recording                                                             | Before the seed script runs        |
| A Helius devnet API key                                                                                      | DAS reads (`getAssetsByOwner`, `getTokenAccounts`) and the send RPC                                              | Before DAS integration             |
| Collection and perk images plus metadata JSON (https URIs, max 200 bytes) for each perk                      | `create_perk` writes `uri` into the perk, the collection and every asset. `set_perk` can replace it later        | Before perks are created on devnet |
| Confirmation that a v0 transaction built from a legacy instruction signs end to end with the Openfort signer | Removes the last unknown in the signing path                                                                     | Before the demo                    |

## 12. Freeze policy

Instruction names, argument order and account order are append-only after the devnet deploy that ships with this document. A breaking change bumps `programVersion` in `shared/addresses/devnet.json` and is announced in the team channel.

Baseline: the 2026-10-08 deploy described here. It changed the layout of the previous same-day deploy (prepended `payer` to buys and `redeem_perk`, appended `kyc` to `sell_tokens`, reshaped `withdraw_artist_vault`, added two `u16` to the config args) and `@mostro/shared`, `scripts/` and these docs were resynced in the same change; see `CHANGELOG.md`. The 2026-10-09 deploy added `redeem_perk.max_paid` (new trailing argument), `CreatePerkArgs.collection_salt` (new trailing field) and `set_curve_metadata`; argument appends still break old encoders, so the SDK copy in `shared/` must match the deployed program.
