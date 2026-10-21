# @mostro/shared

TypeScript SDK the Mostro fronts import to talk to the `mostro` Anchor program on Solana devnet.
It contains the frozen IDL, PDA derivations, bonding-curve math that matches the on-chain
integers to the unit, SOL/USD pricing, instruction builders (buys, perks, admin, governance),
typed account fetchers, holder lists, pass discovery and the program error table with UI copy.

Program id: `4GZtfZvBFXy2YP69kE5cGL1UXjyqhSoZvQPtLtoAVDvG` (localnet and devnet).

This version follows the contract logic agreed on 2026-10-13: one token per artist with a fixed
1B supply, a buy-only curve (no `sell`), cold reserves behind a weighted multisig, a 24 h launch
cool-down, a blacklist instead of KYC, a per-wallet monthly SOL cap, perks paid in tokens or in
SOL (hybrid), and pass benefits handled by the web app. See `programs/mostro/docs/FRONTEND.md`
section 12 for the migration table.

## Install and import

The package is a yarn workspace (`workspaces: ["shared", "fronts/*"]`). From a front:

```ts
import { createReadonlyProgram, fetchCurve, quoteBuyExactIn, buildBuyTokensSol } from "@mostro/shared";
import idl from "@mostro/shared/idl"; // raw IDL JSON
import addresses from "@mostro/shared/addresses/devnet"; // written by the seed
```

The sources are plain `.ts` files (`main` points at `src/index.ts`); Vite / Nuxt / Next transpile them
as part of the app bundle. Dependencies: `@coral-xyz/anchor` 0.32, `@solana/web3.js` 1.x,
`@solana/spl-token`, `@metaplex-foundation/mpl-core` + `umi`, `bn.js`.

The builders return legacy `TransactionInstruction`s (web3.js v1). A `@solana/kit` front converts
them with `fromLegacyTransactionInstruction` from `@solana/compat`. The buyer signs every
user-facing instruction. Buys, `redeem_perk` and `buy_perk_sol` also take a `payer` (rent + Metaplex
Core fee); it defaults to the buyer, so the self-paid case has one signer. Pass `payer: sponsorKey`
for a gas-sponsored transaction (Openfort / Kora); the sponsor then co-signs as transaction fee payer.
Every buy and redeem also passes the buyer's blacklist PDA; the builders do that for you.

## Reading state

```ts
import { Connection } from "@solana/web3.js";
import { createReadonlyProgram, fetchConfig, fetchCurveSnapshot, listArtists, listPerks, listReceiptsByBuyer, summarizePerk, isBlacklisted } from "@mostro/shared";

const connection = new Connection(RPC_URL, "confirmed");
const program = createReadonlyProgram(connection);

const config = await fetchConfig(program); // fees, breakers, price mode, cool-down, spend cap, governance totals
const token = await fetchCurveSnapshot(program, 0); // curve account + live mint (supply = 1B minus burns) + every vault address
const artists = await listArtists(program, true);
const perks = (await listPerks(program, artists[0].publicKey, true)).map(summarizePerk); // .payment is "tokens" | "sol"
const mine = await listReceiptsByBuyer(program, wallet); // "my perks"
const blocked = await isBlacklisted(program, wallet);
```

`listReceiptsByBuyer` uses `getProgramAccounts` with a memcmp at offset 10 (8-byte discriminator +
`bump` + `version`). All offsets are in `OFFSETS` and checked by the test suite against the IDL.

## Quotes

`curve.ts` is a BN.js mirror of `programs/mostro/src/curve.rs`: same formulas, same rounding (tokens
floor, exact-out cost `+1`, fees ceil), same u64/u128 checks. `shared/test/curve.test.ts` runs the same
vectors as the Rust unit tests. There is no sell quote: the curve is buy-only.

```ts
import { quoteBuyExactIn, quoteBuyExactOut, quoteHybridPerk, splitRedeem, minOut, maxIn, spotPrice, marketCap, progressToGraduationBps } from "@mostro/shared";

const c = token.account;
const q = quoteBuyExactIn(c.virtualSolReserves, c.virtualTokenReserves, lamportsIn, config.feeBps);
// q.netIn, q.fee, q.tokensOut, q.totalIn
const minTokensOut = minOut(q.tokensOut, 100); // 1 % slippage

const eo = quoteBuyExactOut(c.virtualSolReserves, c.virtualTokenReserves, tokensOut, config.feeBps);
const maxLamportsIn = maxIn(eo.totalIn, 100);

const h = quoteHybridPerk(c, perk.priceLamports, config.feeBps); // curveHalf, artistHalf, tokensFromCurve, tokensFromArtist, burned, toRewards
const s = splitRedeem(perk.priceTokens); // burn 80 %, rewards 20 %

spotPrice(c); // lamports per whole token
marketCap(c, token.mint.supply); // lamports
progressToGraduationBps(c); // 0..10000 of the 280M curve allocation
```

Demo curve: 30 SOL virtual, 379,000,000 tokens virtual, cap 280,000,000 (the fixed allocation), fee 1 %.
Graduation needs about 85 SOL (`quoteToComplete`). A 0.1 SOL buy at genesis nets 99,009,900 lamports
into the curve with a 990,100 fee and returns about 1,246,000 tokens.

## SOL/USD and USDC buys

`price.ts` mirrors `pricing.rs`. In price mode 0 the admin price in `Config` is used and must be younger than
`config.adminPriceMaxAgeSecs`; in mode 1 the Pyth `PriceUpdateV2` account is decoded
(offsets 40/41/73/81/89/93) and checked for feed id, positivity, age (`config.maxPriceAgeSecs`) and confidence (<= 2 %).

```ts
import { solUsdFromConfig, usdE6ToLamports, PYTH_SOL_USD_ACCOUNT } from "@mostro/shared";

const pyth = config.priceMode === 1 ? (await connection.getAccountInfo(config.pythSolUsdAccount))?.data : undefined;
const { priceE6 } = solUsdFromConfig(config, pyth); // USD per SOL, 6 dp
const lamportsEquiv = usdE6ToLamports(usdcIn, priceE6); // what the program feeds the curve (and the spend cap)
const q = quoteBuyExactIn(c.virtualSolReserves, c.virtualTokenReserves, lamportsEquiv, config.feeBps);
```

## Buying

```ts
import { prepareBuyTokensSol, curveEligibility, remainingSpend, fetchSpend } from "@mostro/shared";

const gate = curveEligibility(config, c, blocked); // BuysPaused | Blacklisted | CurveComplete | SaleNotStarted (cool-down: show gate.opensAt)
const left = remainingSpend(config, await fetchSpend(program, token.curve, buyer)); // null when the cap is off
const { instruction, quote, derived } = await prepareBuyTokensSol(program, c, config.feeBps, { buyer, curveIndex: 0, lamportsIn, slippageBps: 100 });
```

## Perks

```ts
import { perkPayment, redeemEligibility, prepareRedeemPerk, prepareBuyPerkSol, fetchArtist } from "@mostro/shared";

const elig = redeemEligibility(config, perk.account, artist.active, blocked, c); // the curve matters for SOL-priced perks
if (elig.ok && perkPayment(perk.account) === "tokens") {
   const r = await prepareRedeemPerk(program, perk.perk, perk.account, { buyer, curveIndex: 0 }); // max_paid = perk.priceTokens
} else if (elig.ok) {
   const artist = await fetchArtist(program, perk.account.artist);
   const r = await prepareBuyPerkSol(program, c, config.feeBps, perk.perk, perk.account, artist.authority, { buyer, curveIndex: 0 }); // r.quote = quoteHybridPerk(...)
}
```

Both return `derived.asset` / `derived.receipt` (known before confirmation) and encode the exact perk
price as the cap, so a `set_perk` change between quote and confirmation fails with `SlippageExceeded`
instead of overcharging.

### Passes (web-app benefits)

```ts
import { listPassPerks, passPerkRefs, findPassForBuyer, isVip } from "@mostro/shared";

const passPerks = passPerkRefs(await listPassPerks(program));
const pass = await findPassForBuyer(connection, buyer, passPerks); // VIP preferred, or null
```

The program no longer applies discounts, early access or VIP gating. Decide the benefit in the app from
the pass the wallet holds (for example by showing holders a cheaper perk the artist listed for them).

### Artist side

`buildCreatePerk`, `buildSetPerk`, `buildFulfillReceipt`. The perk index for `create_perk` must equal
`artist.perkCount` at execution time, and `curveIndex` is the artist's curve (`artist.curve`).

Rules the program enforces (mirror them in the dashboard before sending):

- `kind: "pass"` perks are **admin-only**; an artist authority gets `Unauthorized`. `canCreatePerk(config, artist, signer, kind)` says who may call; `canSetPerk` likewise for edits.
- Exactly one of `priceTokens` / `priceLamports` is non-zero (`checkPerkPrice`), on `create_perk` and after any `set_perk`.
- The split is fixed (80 % burn / 20 % rewards); there is nothing to configure and no artist token share. Artists earn SOL on hybrid perks, paid straight to `artist.authority`.
- `set_artist` may change `authority` only when signed by the current authority (`canSetArtist(config, artist, signer, changesAuthority)`).
- `buildCreatePerk` takes `args.collectionSalt` (default `DEFAULT_COLLECTION_SALT = 1`); the collection PDA is `["collection", perk, salt]`. Record the salt you used; on-chain `perk.collection` is what every read and both perk instructions should use.

### Governance (admin console)

```ts
import {
   listMembers,
   listProposals,
   listApprovals,
   weightNeeded,
   buildCreateProposal,
   buildApproveProposal,
   buildExecuteVaultTransfer,
   buildExecuteSetMember,
   buildEmergencyPause,
   VaultKind,
} from "@mostro/shared";

const members = await listMembers(program); // role 1 = admin (weight 1), 2 = super-admin (weight 2)
const open = await listProposals(program, true);
const needed = weightNeeded(config.totalWeight); // > 51 %
const p = await buildCreateProposal(program, {
   proposer: me,
   proposalIndex: config.proposalCount,
   args: { kind: "vaultTransfer", vault: VaultKind.ArtistReserve, curve: token.curve, destination: tokenAccount, amount },
});
const a = await buildApproveProposal(program, { member: me, proposal: p.derived.proposal });
const x = await buildExecuteVaultTransfer(program, {
   member: me,
   proposal: p.derived.proposal,
   proposalAccount: await fetchProposal(program, p.derived.proposal),
   curveIndex: 0,
   usdcMint,
});
```

`buildExecuteVaultTransfer` picks `execute_sol_transfer` or `execute_token_transfer` from the vault kind and derives the source vault; `buildExecuteSetMember` applies a membership proposal. `buildEmergencyPause(program, member)` is the circuit breaker any member can pull.

## Holders and errors

```ts
import { topHolders, parseMostroError, errorCopy } from "@mostro/shared";

const holders = await topHolders(connection, token.mint.address, [token.curve]); // the curve PDA owns every vault
try {
   await send(tx);
} catch (e) {
   toast(errorCopy(e)); // "The price changed. Review the new quote and try again."
   parseMostroError(e)?.name; // "SlippageExceeded"
}
```

## PDA seeds

| Account       | Seeds                                                                                  |
| ------------- | -------------------------------------------------------------------------------------- |
| config        | `["config"]`                                                                           |
| treasury      | `["treasury"]` (system account)                                                        |
| treasuryUsdc  | ATA(config, usdcMint)                                                                  |
| curve         | `["curve", curve_index u32 LE]`                                                        |
| mint          | `["mint", curve_index u32 LE]` (mint authority revoked)                                |
| curveVault    | `["curve_vault", curve]` (hot, 280M)                                                   |
| artistReserve | `["artist_reserve", curve]` (cold, 500M)                                               |
| mostroReserve | `["mostro_reserve", curve]` (cold, 150M)                                               |
| dexReserve    | `["dex_reserve", curve]` (cold, 70M)                                                   |
| solVault      | `["sol_vault", curve]`                                                                 |
| rewardsVault  | `["rewards", curve]` (token account)                                                   |
| usdcVault     | ATA(curve, usdcMint)                                                                   |
| metadata      | `["metadata", token_metadata_program, mint]` under the Token Metadata program          |
| artist        | `["artist", artist_index u32 LE]`                                                      |
| perk          | `["perk", artist, perk_index u32 LE]`                                                  |
| collection    | `["collection", perk, collection_salt u64 LE]` (Metaplex Core; read `perk.collection`) |
| asset         | `["asset", perk, nonce u64 LE]` (Core asset)                                           |
| receipt       | `["receipt", asset]`                                                                   |
| blacklist     | `["blacklist", wallet]`                                                                |
| spend         | `["spend", curve, wallet]`                                                             |
| member        | `["member", wallet]`                                                                   |
| proposal      | `["proposal", proposal_index u64 LE]`                                                  |
| approval      | `["approval", proposal, wallet]`                                                       |

All of them are exported from `pda.ts` as `xxxPda(...): [PublicKey, bump]`, so a kit front can
re-derive them with `getProgramDerivedAddress` if it prefers.

## Tests

```sh
# from the repo root
NODE_OPTIONS=--no-experimental-strip-types npx ts-mocha -p tsconfig.json shared/test/*.test.ts
npx tsc --noEmit -p shared/tsconfig.json
```

Node 24 ships native TypeScript stripping, which makes mocha `import()` a `.ts` file before ts-node
gets a chance to compile it; the `NODE_OPTIONS` flag restores the ts-node path. `yarn workspace
@mostro/shared test` sets it for you.
