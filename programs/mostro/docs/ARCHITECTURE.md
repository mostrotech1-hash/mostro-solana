# Architecture: the `mostro` program

Reader: an engineer or reviewer who wants to understand what the program does on-chain and why. After reading, you can follow every lamport and every token through the flows, know who can sign what, and know the current limitations.

This is the contract logic agreed in the 2026-10-13 contract review: one token per artist with a fixed supply, a buy-only curve, cold reserves behind a weighted multisig, a 24 h launch cool-down, a blacklist instead of on-chain KYC, an anti-whale cap, and perks that burn 80 % of the tokens they consume. Pass benefits are applied by the web app, not on-chain.

One Anchor 0.32.1 program, id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`, five concerns:

| Module                       | Concern                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `instructions/config.rs`     | The operator key ("admin"): fees, SOL/USD price source, circuit breakers, blacklist, launch cool-down, anti-whale cap, admin rotation with cool-off            |
| `instructions/governance.rs` | Weighted multisig: proposals, approvals, execution of cold-vault / treasury transfers and membership changes                                                   |
| `instructions/trading.rs`    | Artist tokens: one-shot mint of the fixed supply into four vaults, metadata, mint authority revoked; buy-only constant-product curve served from the hot vault |
| `instructions/artist.rs`     | Artists onboarded by the admin; they manage perks and receive SOL from hybrid perks                                                                            |
| `instructions/perks.rs`      | Perks paid in tokens (`redeem_perk`) or in SOL (`buy_perk_sol`); 80 % burn / 20 % rewards; Metaplex Core asset + receipt per redemption                        |

Pure math lives in `curve.rs` (buy quotes, the fixed split, hybrid halves) and `pricing.rs` (SOL/USD). Neither touches accounts, and both have unit tests. `state.rs` holds every account layout, seed and protocol constant.

## 1. Fixed numbers

These are constants in `state.rs`, not configuration. Changing them is a program upgrade.

| Constant                              | Value                             | Where it bites                                                    |
| ------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `TOTAL_SUPPLY`                        | 1,000,000,000 tokens (6 decimals) | Minted once in `create_curve`; mint authority revoked right after |
| `CURVE_ALLOCATION`                    | 280,000,000 (28 %)                | Hot vault `curve_vault`; also `curve.supply_cap`                  |
| `DEX_ALLOCATION`                      | 70,000,000 (7 %)                  | Cold vault `dex_reserve`, for the DEX pool at graduation          |
| `MOSTRO_ALLOCATION`                   | 150,000,000 (15 %)                | Cold vault `mostro_reserve`                                       |
| `ARTIST_ALLOCATION`                   | 500,000,000 (50 %)                | Cold vault `artist_reserve`; also the artist leg of hybrid perks  |
| `BURN_BPS` / `REWARDS_BPS`            | 8,000 / 2,000                     | Every redeem, both payment modes                                  |
| `THRESHOLD_PERCENT`                   | 51 (strictly more than)           | Proposal execution                                                |
| `WEIGHT_ADMIN` / `WEIGHT_SUPER_ADMIN` | 1 / 2                             | Member voting weight                                              |
| `SPEND_PERIOD_SECS`                   | 30 days                           | Anti-whale window                                                 |

The 35 % "sales" share of the product spec is the 28 % curve allocation plus the 7 % DEX reserve. A `const` assertion keeps the four allocations summing to the total.

## 2. Accounts

```
                       ["config"]                        ["treasury"] (SOL)   ATA(config, USDC)
                    +---------------+                    +-----------------+  +-----------------+
                    |    Config     | admin, fees, price, |    treasury     |  |  treasury_usdc  |
                    |  total_weight | breakers, cool-down,+-----------------+  +-----------------+
                    |  proposal_cnt | cap, ttl                 ^ fees                 ^ fees
                    +-------+-------+                           moved only by an executed proposal
                            |
      +---------------------+----------------------+------------------------+
      v                     v                      v                        v
 ["member", wallet]   ["proposal", i]        ["artist", j]            ["blacklist", wallet]
 +--------------+     +---------------+      +------------------+     +----------------+
 |   Member     |     |   Proposal    |      |     Artist       |     |   Blacklist    |
 |  role (0/1/2)|     | kind, vault,  |      | authority        |     | blocked        |
 +--------------+     | dest, amount, |      | curve -----------+--+  +----------------+
        ^ votes       | wallet, role, |      | perk_count       |  |
        |             | approved_wt   |      | revenue_lamports |  |
 ["approval", proposal, wallet]             +--------+---------+  |
 +--------------+                                     | perk_count  |
 |  Approval    |                                     v             v
 | weight, ts   |                           ["perk", artist, k]   ["curve", i]
 +--------------+                           +-----------------+   +-------------------------+
                                            |      Perk       |   |        Curve            |
                                            | kind, tier      |   | artist, mint            |
                                            | price_tokens    |   | virtual_sol/_tokens     |
                                            | price_lamports  |   | real_sol_reserves       |
                                            | max_supply,sold |   | supply_cap = 280M       |
                                            | public_start_ts |   | tokens_sold             |
                                            | collection -----+-+ | artist_reserve_used     |
                                            +--------+--------+ | | sale_start_ts, complete |
                                                     |          | +----+--+--+--+--+--+--+--+
                                      ["asset", perk, nonce]   |      |  |  |  |  |  |  |
                                      Core BaseAssetV1  <------+      |  |  |  |  |  |  +--> ["mint", i]       SPL mint, authority = None
                                      owner = buyer       member of   |  |  |  |  |  +-----> ["curve_vault", curve]    hot, 280M
                                      attrs: kind, tier,  collection  |  |  |  |  +--------> ["artist_reserve", curve] cold, 500M
                                             artist, edition          |  |  |  +-----------> ["mostro_reserve", curve] cold, 150M
                                               |                      |  |  +--------------> ["dex_reserve", curve]    cold, 70M
                                      ["receipt", asset]              |  +-----------------> ["rewards", curve]        20 % of redeems
                                      +----------------+              +--------------------> ["sol_vault", curve]      SOL from buys
                                      |    Receipt     |                                     ATA(curve, USDC)          USDC from buys
                                      | buyer, perk,   |
                                      | paid_*, burned,|          ["spend", curve, wallet]   SpendTracker: period, spent_lamports
                                      | to_rewards,    |
                                      | lamports_to_*  |
                                      +----------------+
```

Who signs for what:

| Authority                                                      | Held by                                                    | Used in                                                                           |
| -------------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Mint authority                                                 | nobody (revoked in `create_curve`)                         | never again                                                                       |
| `curve_vault`, the three reserves, `rewards_vault`, USDC vault | `curve` PDA                                                | buys and hybrid perks (hot vault, artist reserve); `execute_token_transfer` (all) |
| `sol_vault` lamports                                           | `sol_vault` PDA (system account, program signs with seeds) | `execute_sol_transfer`                                                            |
| `treasury` SOL, `treasury_usdc`                                | `treasury` PDA / `config` PDA                              | `execute_sol_transfer`, `execute_token_transfer`                                  |
| Core collection update authority                               | `artist` PDA                                               | `redeem_perk`, `buy_perk_sol` (mint into collection)                              |
| Core asset creation                                            | `asset` PDA signs its own creation                         | `redeem_perk`, `buy_perk_sol`                                                     |

Every token account is an `InterfaceAccount` with an explicit `token_program`, so a Token-2022 mint works without code changes. The devnet deployment uses the legacy token program.

## 3. Flows

### 3.1 Create an artist token (`create_curve`, admin)

```
require artist.curve == default              (one token per artist)
sale_start_ts = max(args.sale_start_ts, now + config.launch_cooldown_secs)
fund sol_vault with the rent floor
mint 280M -> curve_vault, 500M -> artist_reserve, 150M -> mostro_reserve, 70M -> dex_reserve   signer: curve PDA
create Token Metadata (name, symbol, uri; mint + update authority = curve)                    needs the mint authority
set_authority(mint, MintTokens, None)                                                         supply fixed forever
artist.curve = curve
```

Everything happens in one instruction so there is never a token whose supply can still grow or that lacks metadata. The curve's virtual reserves come from the arguments (`virtual_token_reserves` must exceed the 280M allocation); `supply_cap` is the allocation itself.

### 3.2 Launch cool-down

`created_at + launch_cooldown_secs` is the earliest `sale_start_ts` (the admin may push it later, not earlier). Buys before that fail with `SaleNotStarted`. The product value is 24 h (`86_400`); `initialize_config` takes it as an argument so a devnet seed can use a shorter one, and `set_config` can change it for future tokens (existing curves keep the `sale_start_ts` they were created with).

### 3.3 Buy on the curve with SOL

```
gates   !buys_paused, !complete, now >= sale_start_ts, not blacklisted, spend cap
buyer --lamports_in--> [fee -> treasury] [net -> sol_vault]
curve: virtual_sol += net, virtual_tokens -= out, real_sol += net, tokens_sold += out
curve_vault --out--> buyer_ata                      signer: curve PDA (a transfer, not a mint)
spend.spent_lamports += lamports_in                  (reset when the 30-day period changed)
```

`net = (lamports_in - 1) * 10_000 / (10_000 + fee_bps)`, `out = net * VT / (VQ + net)`. The integer formulas follow the MIT-licensed `@pump-fun/pump-sdk`, so a TypeScript quote and the on-chain result agree to the unit. `buy_tokens_exact_out_sol` inverts the formula: `cost = t * VQ / (VT - t) + 1`, `fee = ceil(cost * fee_bps / 10_000)`.

A buy that would push `tokens_sold` past `supply_cap` fails with `CurveSoldOut`; there is no partial fill. Reaching the cap exactly sets `complete = true` and the primary market closes for good (there is no sell to reopen it).

Two signers: `buyer` pays the SOL and receives the tokens; `payer` pays the rent of `buyer_ata` and of the `SpendTracker` when they have to be created. They are the same key unless a sponsor pays the gas (3.11).

### 3.4 Buy on the curve with USDC

```
price_e6 = sol_usd(config, price_update)           mode 0: config value, mode 1: Pyth
lamports_equiv = usdc_in * 1e9 / price_e6
quote = buy_exact_in(VQ, VT, lamports_equiv)         same curve, same formula
usdc_fee = usdc_in * quote.fee / lamports_equiv
buyer_usdc --usdc_fee--> treasury_usdc
buyer_usdc --usdc_in - usdc_fee--> usdc_vault (ATA of curve)
curve: virtual_sol += quote.net_in, virtual_tokens -= out, real_usdc += usdc_net
curve_vault --out--> buyer_ata
spend.spent_lamports += lamports_equiv
```

The curve is quoted in SOL. A USDC buy moves the virtual reserves as if the SOL equivalent had been paid, so the price buyers see is the same in both currencies, and it counts against the anti-whale cap at that equivalent. The USDC stays in `usdc_vault` until governance moves it.

### 3.5 No sells

There is no sell instruction. The primary market only supports the price with buys; holders exit on the DEX after graduation. Consequently `real_sol_reserves` only grows until governance withdraws it (3.9), and `complete` never flips back.

### 3.6 Anti-whale cap

`SpendTracker` (`["spend", curve, wallet]`) counts the lamports a wallet put into one curve in the current 30-day period (`period = unix_time / 2_592_000`; a buy in a new period resets the counter). When `config.max_spend_per_period_lamports > 0`, every curve purchase (SOL buy, USDC buy at its SOL equivalent, the curve half of a hybrid perk) fails with `SpendCapExceeded` once the counter would exceed it. `0` disables the cap. The tracker is created on the wallet's first purchase, rent paid by `payer`.

### 3.7 Blacklist

Every wallet is allowed by default: identity verification happens at the Openfort / Sumsub layer, not on-chain. `set_blacklist(wallet, blocked)` lets the admin block a wallet. Buys and redeems take the wallet's `["blacklist", wallet]` PDA as a seeds-checked, possibly empty account: an empty account means never blacklisted; an existing one with `blocked == true` fails with `Blacklisted`. Because the seeds are checked, a client cannot substitute another wallet's (empty) entry.

### 3.8 Perks

A perk is priced either in tokens (`price_tokens > 0`) or in SOL (`price_lamports > 0`), never both (`InvalidPerkPrice`). Both modes mint a Metaplex Core asset into the perk's collection for the buyer, write a `Receipt`, and apply the fixed 80 / 20 split to every token involved. Gates shared by both: `!redeems_paused`, `perk.active`, `artist.active`, supply left, `now >= public_start_ts`, buyer not blacklisted.

**Token-priced (`redeem_perk(nonce, max_paid)`)**

```
require price_tokens <= max_paid                       (SlippageExceeded: caller's price cap)
(burned, to_rewards) = split(price_tokens)             burned = floor(80 %), rewards = the rest
burn(buyer_ata, burned)                                visible as a Burn in explorers
buyer_ata --to_rewards--> rewards_vault
mint Core asset; write Receipt{paid_tokens, burned, to_rewards}
perk.sold += 1; curve.total_burned += burned; curve.rewards_accrued += to_rewards
```

**SOL-priced, hybrid (`buy_perk_sol(nonce, max_lamports)`)**

```
require price_lamports <= max_lamports
also the buy gates: !buys_paused, !complete, curve open, spend cap on the curve half
curve_half = price / 2; artist_half = price - curve_half
q = buy_exact_in(VQ, VT, curve_half, fee_bps)          the curve leg is a normal buy
require artist_reserve.amount >= q.tokens_out
buyer --q.net_in--> sol_vault; buyer --q.fee--> treasury; buyer --artist_half--> artist.authority
(b, r) = split(q.tokens_out)
curve_vault:    burn b, --r--> rewards_vault             signer: curve PDA
artist_reserve: burn b, --r--> rewards_vault             signer: curve PDA
curve: apply_buy(net, q.tokens_out), real_sol += net, artist_reserve_used += q.tokens_out,
       total_burned += 2b, rewards_accrued += 2r
artist.revenue_lamports += artist_half
mint Core asset; write Receipt{paid_lamports, tokens_from_curve, tokens_from_artist, burned, to_rewards, lamports_to_*}
```

Half of the SOL buys tokens on the curve (and moves its price like any buy); the other half pays the artist directly in SOL. The same number of tokens leaves the artist reserve. All of those tokens are burned / sent to rewards from the vaults themselves; the buyer never holds them, which is the same accounting as "sent to the buyer, then recovered" without the round trip or a buyer token account. The product spec's example (a 2 SOL drop, 100 copies) is a perk with `price_lamports = 2e9`, `max_supply = 100`.

**Edition and metadata.** The edition number is `perk.sold + 1` and lives in the asset's `Edition` plugin and the receipt. The asset's `Attributes` plugin carries `kind`, `tier`, `artist` and `edition`; the program does not interpret the perk, the web app does. The asset seed uses a client nonce so concurrent buyers do not collide and the client knows the asset address before confirmation. The collection PDA is `["collection", perk, collection_salt]`, salted by a `u64` the creator passes in `CreatePerkArgs`, so a perk whose collection CPI failed half-way can be recreated under a fresh address; `perk.collection` records the one in use.

### 3.9 Governance (weighted multisig)

Members are `Member` PDAs with a role: admin (weight 1) or super-admin (weight 2); `role == 0` is a removed member. `Config.total_weight` is the sum of live weights. `initialize_config` seats the admin key as the founding super-admin, so there is always a voter.

```
create_proposal(args)      by a member; records the proposer's approval; expires at now + proposal_ttl_secs
approve_proposal           by a member; one Approval PDA per member per proposal (a second one fails: account exists)
execute_*                  by any member once approved_weight * 100 > total_weight * 51 and before expiry
cancel_proposal            by the proposer or any super-admin
```

| Proposal kind   | Payload                                                              | Executor                                                                                                                                                                                   |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `VaultTransfer` | `curve` (zero for treasury vaults), `vault`, `destination`, `amount` | `execute_token_transfer` for `artist_reserve`, `mostro_reserve`, `dex_reserve`, `rewards`, the curve USDC vault and `treasury_usdc`; `execute_sol_transfer` for `sol_vault` and `treasury` |
| `SetMember`     | `wallet`, `role` (0 removes)                                         | `execute_set_member`: updates `total_weight` and `member_count`; refuses to drop the total to 0 (`LastMember`)                                                                             |

The executor recomputes the source account from the vault kind and the proposal's curve (`ProposalMismatch` otherwise), so the only thing a proposal can move is the named vault to the named destination. SOL vaults keep their rent floor. `execute_sol_transfer` from `sol_vault` also decrements `curve.real_sol_reserves`.

The threshold is dynamic: with 5 super-admins and 5 admins (total 15) a proposal needs weight 8; with the founding super-admin alone (total 2) it passes with that single vote, which is how the first members are appointed. Approvals are weighed when cast; removing a member later does not retract its vote on open proposals (cancel them if that matters).

Any member can pull the circuit breaker (`emergency_pause`: `buys_paused = redeems_paused = true`); only the admin resumes, through `set_config`.

### 3.10 The operator key

`Config.admin` is the hot key for day-to-day operations: `set_config` (fees, price source and admin price, both circuit breakers, launch cool-down, anti-whale cap, proposal TTL), `set_blacklist`, `create_artist`, `create_curve`, Pass perks, and `set_artist` / `set_perk` / `fulfill_receipt` alongside the artist. It cannot move tokens out of any vault or SOL out of the treasury: those balances only move through executed proposals. `propose_admin(new)` records `pending_admin` and `admin_transfer_ready_ts = now + admin_cooloff_secs`; `accept_admin` must be signed by the pending admin after that time; `cancel_admin_transfer` clears it.

### 3.11 Payer / buyer split (gas sponsorship)

`buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc`, `redeem_perk` and `buy_perk_sol` declare two signers: `payer` (first) and `buyer`. `payer` is the `payer =` of every `init` / `init_if_needed` in those instructions (`buyer_ata`, `spend`, `receipt`) and the `.payer()` of the Core `CreateV2` CPI, so it carries rent and the Core protocol fee. Everything else is tied to `buyer`: the lamports or USDC debited, the token account authority, the asset owner, the receipt's `buyer`, the blacklist and spend lookups. In the self-paid case the client passes the same key twice and the transaction has one signature. A sponsor (Openfort's embedded wallet gas policy, or a Kora paymaster) passes its funded key as `payer`, is the transaction fee payer, and co-signs after the buyer. The program only verifies that `payer` signed; what the sponsor agrees to pay for is the sponsor's policy.

### 3.12 Price modes

| `config.price_mode` | Source                                                 | Checks                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 (admin)           | `config.sol_usd_price_e6`, written by `set_config`     | `> 0`; `now - config.price_updated_ts <= admin_price_max_age_secs`                                                                                                                                                                                                       |
| 1 (Pyth)            | the `price_update` account passed to `buy_tokens_usdc` | key == `config.pyth_sol_usd_account`; owner == Pyth receiver program; verification level `Full`; feed id == `config.pyth_feed_id`; `price > 0`; `now - publish_time <= max_price_age_secs`; `conf * 10_000 <= price * 200` (confidence within 2%, else `PriceUncertain`) |

`PriceUpdateV2` is decoded by hand at fixed offsets (price at 73, conf at 81, exponent at 89, publish time at 93) instead of through `pyth-solana-receiver-sdk`, because the SDK versions that build with Anchor 0.32 conflict with `mpl-core` in the same lockfile. The offsets hold only for the `Full` verification level, which is the only one accepted.

## 4. Who may do what

| Action                                                                                                   | Signer                               | Error otherwise                                                         |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------------------------- |
| `initialize_config`                                                                                      | program upgrade authority            | `Unauthorized`                                                          |
| `set_config`, `set_blacklist`, `create_artist`, `create_curve`, `propose_admin`, `cancel_admin_transfer` | `config.admin`                       | `Unauthorized`                                                          |
| `create_perk` / `set_perk` with `kind == Pass`                                                           | `config.admin`                       | `Unauthorized`                                                          |
| `create_perk` / `set_perk` other kinds, `fulfill_receipt`                                                | `artist.authority` or `config.admin` | `Unauthorized`                                                          |
| `set_artist` with `authority` set                                                                        | current `artist.authority` only      | `Unauthorized`                                                          |
| `create_proposal`, `approve_proposal`, `execute_*`, `emergency_pause`                                    | any member (`role != 0`)             | `NotAMember` (or `AccountNotInitialized` when the wallet never was one) |
| `cancel_proposal`                                                                                        | the proposer or a super-admin        | `Unauthorized`                                                          |
| moving any vault or treasury balance                                                                     | an executed proposal                 | no instruction exists                                                   |

Passes are a platform product, so only the protocol issues them; an artist cannot mint a "Mostro Pass". The admin cannot reach an artist's SOL income by rotating `artist.authority`, because only the current authority can hand an artist over. The treasury and every vault keep their rent-exempt floor so no PDA can be garbage-collected while funds still flow in.

## 5. Limitations (current code)

- **Burning does not move the price.** The curve prices on virtual reserves. A redeem burns tokens: `mint.supply` and market cap drop, the spot price does not. Hybrid perks do move the price, through their curve leg.
- **The rewards vault has no distribution logic.** `rewards_vault` accrues 20 % of every redeem; governance can move it (`VAULT_REWARDS`), but there is no holder-facing `claim_rewards` yet.
- **USDC paid on the curve does not back anything.** It sits in `usdc_vault` until governance moves it. Since there are no sells, nothing needs to be backed; the DEX seeding at graduation is an off-chain operation using the reserves governance releases.
- **Graduation is manual.** `complete = true` closes the curve; moving `dex_reserve` and `sol_vault` into a DEX pool is a governance proposal plus an off-chain pool creation. The "similar logic on the DEX" for hybrid perks after graduation is not implemented.
- **Launch cool-down is per-token at creation.** Changing `launch_cooldown_secs` affects tokens created afterwards.
- **Spend cap is per curve.** A wallet's cap is counted per artist token, which matches "per artist and per month"; it is not a global cap across artists.
- **Approvals do not follow membership changes.** A removed member's approval keeps counting on proposals it already approved; the proposal must be cancelled to discard it. The dynamic threshold, however, always uses the live total weight.
- **Admin-set price in mode 0.** The admin sets the SOL/USD conversion used for USDC buys; it expires after `admin_price_max_age_secs`, which bounds staleness but not the value. Mode 1 (Pyth) removes that trust.
- **One URI per perk.** Every asset of a perk points at `perk.uri`; editions differ only by name and attributes.
- **`set_perk(max_supply)` does not update the collection.** The Core collection's `MasterEdition` plugin keeps the `max_supply` given at `create_perk`; the program enforces the new value from the `Perk` account.
- **The collection salt is not stored.** `perk.collection` is, so reads are unaffected, but re-deriving a collection address off-chain needs the salt the creator used.
- **Admin-only onboarding.** `create_artist` and `create_curve` require the admin.
- **`set_config` is immediate.** Only the admin transfer has a cool-off. Fee, price mode, breakers, cap and cool-down change in one transaction.
- **No partial fills on the cap.** A buy that crosses `supply_cap` fails instead of filling the remainder.
- **Program size.** The `.so` is about 899 KB; the devnet program account reserves 800,000 bytes, so the next upgrade needs `solana program extend` first (see the README).

## 6. Roadmap

Ordered by what unblocks the most:

1. Move the upgrade authority itself under the multisig (today it is the deployer key; the program's own multisig governs vaults, not upgrades).
2. `claim_rewards`: distribute `rewards_vault` to holders or pass owners (design open).
3. Graduation instruction: move `dex_reserve` + `sol_vault` into a DEX pool in one governed step; hybrid perks sourcing from the DEX after graduation.
4. `update_perk_asset` / per-edition metadata URIs for fulfilled merch; `update_curve_metadata`.
5. Permissionless artist onboarding with a creation fee.
6. Migrate to Anchor 1.x once `mpl-core` ships an `anchor-1` feature; generate a kit-native client with Codama.
7. External security audit before any mainnet deploy.
