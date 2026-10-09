# @mostro/shared

TypeScript SDK the Mostro fronts import to talk to the `mostro` Anchor program on Solana devnet.
It contains the frozen IDL, PDA derivations, bonding-curve math that matches the on-chain
integers to the unit, SOL/USD pricing, instruction builders, typed account fetchers, holder
lists, pass discovery and the program error table with UI copy.

Program id: `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK` (localnet and devnet).

## Install and import

The package is a yarn workspace (`workspaces: ["shared", "fronts/*"]`). From a front:

```ts
import { createReadonlyProgram, fetchCurve, quoteBuyExactIn, buildBuyTokensSol } from "@mostro/shared";
import idl from "@mostro/shared/idl"; // raw IDL JSON
import addresses from "@mostro/shared/addresses/devnet"; // written on each deploy
```

The sources are plain `.ts` files (`main` points at `src/index.ts`); Vite / Nuxt / Next transpile them
as part of the app bundle. Dependencies: `@coral-xyz/anchor` 0.32, `@solana/web3.js` 1.x,
`@solana/spl-token`, `@metaplex-foundation/mpl-core` + `umi`, `bn.js`.

The builders return legacy `TransactionInstruction`s (web3.js v1). A `@solana/kit` front converts
them with `fromLegacyTransactionInstruction` from `@solana/compat`. The buyer/seller signs every
user-facing instruction. Buys and `redeem_perk` also take a `payer` (rent + Metaplex Core fee); it
defaults to the buyer, so the self-paid case has one signer. Pass `payer: sponsorKey` for a
gas-sponsored transaction (Openfort / Kora); the sponsor then co-signs as transaction fee payer.

## Reading state

```ts
import { Connection } from "@solana/web3.js";
import { createReadonlyProgram, fetchConfig, fetchCurveSnapshot, listArtists, listPerks, listReceiptsByBuyer, summarizePerk } from "@mostro/shared";

const connection = new Connection(RPC_URL, "confirmed");
const program = createReadonlyProgram(connection);

const config = await fetchConfig(program); // fee_bps, paused, kyc_required, price mode, pass benefits, split floors (minBurnBps / minRewardsBps)
const most = await fetchCurveSnapshot(program, 0); // curve account + live mint (supply reflects burns)
const artists = await listArtists(program, true);
const perks = (await listPerks(program, artists[0].publicKey, true)).map(summarizePerk);
const mine = await listReceiptsByBuyer(program, wallet); // "my perks"
```

`listReceiptsByBuyer` uses `getProgramAccounts` with a memcmp at offset 10 (8-byte discriminator +
`bump` + `version`). All offsets are in `OFFSETS` and checked by the test suite against the IDL.

## Quotes

`curve.ts` is a BN.js mirror of `programs/mostro/src/curve.rs`: same formulas, same rounding (tokens
floor, exact-out cost `+1`, fees ceil), same u64/u128 checks. `shared/test/curve.test.ts` runs the same
vectors as the Rust unit tests.

```ts
import { quoteBuyExactIn, quoteBuyExactOut, quoteSell, minOut, maxIn, spotPrice, marketCap, progressToGraduationBps } from "@mostro/shared";

const c = most.account;
const q = quoteBuyExactIn(c.virtualSolReserves, c.virtualTokenReserves, lamportsIn, config.feeBps);
// q.netIn, q.fee, q.tokensOut, q.totalIn
const minTokensOut = minOut(q.tokensOut, 100); // 1 % slippage

const eo = quoteBuyExactOut(c.virtualSolReserves, c.virtualTokenReserves, tokensOut, config.feeBps);
const maxLamportsIn = maxIn(eo.totalIn, 100);

const s = quoteSell(c.virtualSolReserves, c.virtualTokenReserves, tokensIn, config.feeBps);
const minLamportsOut = minOut(s.netOut, 100);

spotPrice(c); // lamports per whole token
marketCap(c, most.mint.supply); // lamports
progressToGraduationBps(c); // 0..10000
```

Demo curve ("set B"): 30 SOL virtual, 1,000,000 tokens virtual, cap 800,000, fee 1 %. Graduation
needs 120 SOL (`quoteToComplete`). A 0.1 SOL buy at genesis nets 99,009,900 lamports into the curve
with a 990,100 fee.

## SOL/USD and USDC buys

`price.ts` mirrors `pricing.rs`. In price mode 0 the admin price in `Config` is used and must be younger than
`config.adminPriceMaxAgeSecs` (86,400 s on devnet); in mode 1 the Pyth `PriceUpdateV2` account is decoded
(offsets 40/41/73/81/89/93) and checked for feed id, positivity, age (`config.maxPriceAgeSecs`, 300 s) and confidence (<= 2 %).

```ts
import { solUsdFromConfig, usdE6ToLamports, lamportsToUsdE6, PYTH_SOL_USD_ACCOUNT } from "@mostro/shared";

const pyth = config.priceMode === 1 ? (await connection.getAccountInfo(config.pythSolUsdAccount))?.data : undefined;
const { priceE6 } = solUsdFromConfig(config, pyth); // USD per SOL, 6 dp
const lamportsEquiv = usdE6ToLamports(usdcIn, priceE6); // what the program feeds the curve
const q = quoteBuyExactIn(c.virtualSolReserves, c.virtualTokenReserves, lamportsEquiv, config.feeBps);
```

Before enabling "Buy" in mode 1, decode the Pyth account and warn if `publishTime` is older than
`config.maxPriceAgeSecs`. In mode 0 pass the whole `Config` to `solUsdFromConfig` so it applies the admin age check,
and surface `PriceTooOld` as "price refresh pending" rather than as a user error.

## Building instructions

Every builder resolves all accounts and returns `{ instruction, derived }`.

```ts
import { buildBuyTokensSol, buildBuyTokensExactOutSol, buildBuyTokensUsdc, buildSellTokens, buildRedeemPerk, prepareBuyTokensSol } from "@mostro/shared";

// Buy $MOST with SOL (curve 0). Creates the buyer's ATA if needed.
const { instruction } = await buildBuyTokensSol(program, { buyer, curveIndex: 0, lamportsIn, minTokensOut });

// Quote + build in one step with 1 % slippage
const { instruction: ix2, quote } = await prepareBuyTokensSol(program, c, config.feeBps, { buyer, curveIndex: 0, lamportsIn, slippageBps: 100 });

// Buy with USDC (buyer already holds devnet USDC in their ATA)
await buildBuyTokensUsdc(program, { buyer, curveIndex: 0, usdcIn, minTokensOut, usdcMint: config.usdcMint, priceUpdate: config.pythSolUsdAccount });

// Sell (no payer: nothing is created). Same optional `kyc` as the buys.
await buildSellTokens(program, { seller: buyer, curveIndex: 0, tokensIn, minLamportsOut });

// Redeem a perk (mints a Metaplex Core asset + receipt). Nonce is random unless given. `maxPaid` is the price cap
// (`SlippageExceeded` if the effective price is higher); pass `perk.collection` from the account (the PDA is salted).
const redeem = await buildRedeemPerk(program, { buyer, artistIndex: 0, perkIndex: 3, curveIndex: 0, pass: null, maxPaid: perk.account.price, collection: perk.account.collection });
// Or let the SDK compute the discounted price and fill maxPaid/collection/artist from the fetched perk:
const prepared = await prepareRedeemPerk(program, config, perk.perk, perk.account, pass?.tier ?? null, { buyer, curveIndex: 0, pass: toPassAccounts(pass) });
prepared.paid; // tokens the buyer will pay, also encoded as max_paid
redeem.derived.asset; // exact address of the asset that will be minted
redeem.derived.receipt; // exact address of the receipt
redeem.derived.nonce;
redeem.derived.payer; // == buyer here

// Gas-sponsored: the sponsor pays ATA / receipt / asset rent and the Core fee, the buyer still pays the trade.
const sponsored = await buildRedeemPerk(program, {
   buyer,
   payer: sponsor,
   artistIndex: 0,
   perkIndex: 3,
   curveIndex: 0,
   maxPaid: perk.account.price,
   collection: perk.account.collection,
});
// tx.feePayer = sponsor; buyer.partialSign(tx); then hand the tx to the sponsor (Kora / Openfort) to co-sign and send.
```

When `config.kycRequired` is true pass `kyc: true` to the buy **and sell** builders so the `["kyc", wallet]` PDA is
included; the program gates both directions with the same record. `redeem_perk` is not gated. **Devnet has `kycRequired = true`**:
every wallet needs an admin approval (`scripts/set-kyc.ts <wallet> true GB`) before its first buy or sell; check `fetchKyc` at connect.

Send parameters (`SEND_DEFAULTS`): `setComputeUnitLimit(400_000)`, `setComputeUnitPrice(>= 1_000)`,
`preflightCommitment: "confirmed"`. Retrying with a fresh blockhash and the same nonce is safe: the
instruction fails cleanly if the asset was already minted.

### Passes (discount, early access, VIP gating)

```ts
import { listPassPerks, passPerkRefs, findPassForBuyer, toPassAccounts, redeemEligibility } from "@mostro/shared";

const passPerks = passPerkRefs(await listPassPerks(program));
const pass = await findPassForBuyer(connection, buyer, passPerks); // VIP preferred, or null
const elig = redeemEligibility(config, perk.account, artist.active, pass?.tier ?? null, undefined, pass?.active ?? true);
if (elig.ok) {
   await prepareRedeemPerk(program, config, perk.perk, perk.account, pass?.tier ?? null, { buyer, curveIndex: 0, pass: toPassAccounts(pass) });
}
```

On-chain benefits (from `Config`, defaults): Standard 5 % off / 24 h early, VIP 15 % off / 72 h early,
`vip_only` perks. The price the buyer pays is `applyDiscount(perk.price, discountBps)` when
`perk.discountEligible`; the split is `splitRedeem(paid, perk.burnBps, perk.rewardsBps)` (default 80 %
burn / 20 % rewards / 0 % artist).

### Artist side

`buildCreatePerk`, `buildSetPerk`, `buildFulfillReceipt`, `buildWithdrawArtistVault`. The perk index for
`create_perk` must equal `artist.perkCount` at execution time.

Rules the program enforces (mirror them in the dashboard before sending):

- `kind: "pass"` perks are **admin-only**; an artist authority gets `Unauthorized`. `canCreatePerk(config, artist, signer, kind)` says who may call.
- Every split must satisfy `burnBps + rewardsBps <= 10_000`, `burnBps >= config.minBurnBps`, `rewardsBps >= config.minRewardsBps`
  (else `InvalidBps`), on `create_perk` and on `set_perk`. `checkPerkSplit(config, burnBps, rewardsBps)` returns the reason.
- `buildWithdrawArtistVault({ authority, artistIndex, curveIndex, amount })` is signed by `artist.authority` **only**; the
  protocol admin cannot withdraw an artist vault, and the instruction takes no `config` account.
- `set_perk` on a Pass perk is admin-only too (`canSetPerk`); `set_artist` may change `authority` only when signed by the current
  authority (`canSetArtist(config, artist, signer, changesAuthority)`).
- `buildCreatePerk` takes `args.collectionSalt` (default `DEFAULT_COLLECTION_SALT = 1`); the collection PDA is
  `["collection", perk, salt]`. Record the salt you used; on-chain `perk.collection` is what every read and `redeem_perk` should use.

## Holders and errors

```ts
import { topHolders, parseMostroError, errorCopy } from "@mostro/shared";

const holders = await topHolders(connection, most.mint.address, [most.rewardsVault, artistVault]);
try {
   await send(tx);
} catch (e) {
   toast(errorCopy(e)); // "The price moved. Review the new quote and try again."
   parseMostroError(e)?.name; // "SlippageExceeded"
}
```

## PDA seeds

| Account      | Seeds                                                                                  |
| ------------ | -------------------------------------------------------------------------------------- |
| config       | `["config"]`                                                                           |
| treasury     | `["treasury"]` (system account)                                                        |
| treasuryUsdc | ATA(config, usdcMint)                                                                  |
| curve        | `["curve", curve_index u32 LE]`                                                        |
| mint         | `["mint", curve_index u32 LE]`                                                         |
| solVault     | `["sol_vault", curve]`                                                                 |
| rewardsVault | `["rewards", curve]` (token account)                                                   |
| usdcVault    | ATA(curve, usdcMint)                                                                   |
| artist       | `["artist", artist_index u32 LE]`                                                      |
| artistVault  | `["artist_vault", artist, mint]`                                                       |
| perk         | `["perk", artist, perk_index u32 LE]`                                                  |
| collection   | `["collection", perk, collection_salt u64 LE]` (Metaplex Core; read `perk.collection`) |
| asset        | `["asset", perk, nonce u64 LE]` (Core asset)                                           |
| receipt      | `["receipt", asset]`                                                                   |
| kyc          | `["kyc", wallet]`                                                                      |

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
