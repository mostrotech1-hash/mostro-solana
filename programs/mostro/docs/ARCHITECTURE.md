# Architecture: the `mostro` program

Reader: an engineer or reviewer who wants to understand what the program does on-chain and why. After reading, you can follow every lamport and every token through the four flows and know the current limitations.

One Anchor 0.32.1 program, id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`, four concerns:

| Module                    | Concern                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `instructions/config.rs`  | Admin with cool-off transfer, pause switch, protocol fee, SOL/USD price source, KYC attestations, treasury withdrawals |
| `instructions/trading.rs` | A constant-product bonding curve that mints `$MOST` on demand for SOL or USDC and buys it back for SOL                 |
| `instructions/artist.rs`  | Artists that open perks and collect their share in a vault                                                             |
| `instructions/perks.rs`   | Perks priced in `$MOST`; redeeming burns part of the payment, routes the rest, and mints a Metaplex Core asset         |

Pure math lives in `curve.rs` (curve quotes, splits, discounts) and `pricing.rs` (SOL/USD). Neither touches accounts, and both have unit tests.

## 1. Accounts

```
                               ["config"]                     ["treasury"]
                            +--------------+               +-----------------+
                            |    Config    |  admin, fee,  |  treasury (SOL) |
                            |              |  price, pass  +-----------------+
                            |  admin ------+-- benefits,   | treasury_usdc   |  ATA(config, USDC)
                            |  usdc_mint   |  kyc_required +-----------------+
                            +------+-------+
                                   | curve_count / artist_count
          +------------------------+---------------------------+
          v                                                    v
 ["curve", i]                                          ["artist", j]
+----------------------+                              +----------------------+
|        Curve         |  mint authority              |        Artist        |
|  virtual_sol         +---------> ["mint", i]        |  authority (wallet)  |
|  virtual_tokens      |           $MOST mint         |  perk_count          |
|  real_sol_reserves   |                              |  revenue_tokens      |
|  supply_cap, sold    |  signer for                  +----------+-----------+
+--+-------+-------+---+  all vaults                             |
   |       |       |                                             | perk_count
   |       |       +--> ["sol_vault", curve]   system account    v
   |       |            real SOL that backs sells      ["perk", artist, k]
   |       +----------> ["rewards", curve]     token acct   +----------------------+
   |                    20% of every redeem             |         Perk         |
   +------------------> ATA(curve, USDC)       usdc_vault  |  kind, tier, price   |
                        USDC received on buys           |  burn/rewards bps    |
                                                        |  max_supply, sold    |
 ["artist_vault", artist, mint]  token acct             |  public_start_ts     |
   artist share of redeems, authority = artist          |  vip_only, discount  |
                                                        +----+-----------+-----+
 ["kyc", wallet]                                             |           |
+----------------+                               ["collection", perk]   |
|      Kyc       |  approved, country             Metaplex Core          |
+----------------+                               BaseCollectionV1       |
                                                 update authority =     |
                                                 artist PDA             |
                                                        ^               |
                                                        | member        v
                                                 ["asset", perk, nonce]      ["receipt", asset]
                                                 Metaplex Core BaseAssetV1   +------------------+
                                                 owner = buyer               |     Receipt      |
                                                 plugins: Attributes,        |  buyer, perk,    |
                                                 Edition                     |  paid, burned,   |
                                                                             |  pass_used,      |
                                                                             |  fulfilled       |
                                                                             +------------------+
```

Who signs for what:

| Authority                        | Held by                                                    | Used in                                           |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------------------- |
| `$MOST` mint authority           | `curve` PDA                                                | `buy_tokens_*` (mint)                             |
| `sol_vault` lamports             | `sol_vault` PDA (system account, program signs with seeds) | `sell_tokens`                                     |
| `rewards_vault` tokens           | `curve` PDA                                                | no instruction spends it yet                      |
| `usdc_vault` tokens              | `curve` PDA                                                | no instruction spends it yet                      |
| `artist_vault` tokens            | `artist` PDA                                               | `withdraw_artist_vault` (artist authority only)   |
| `treasury` SOL, `treasury_usdc`  | `treasury` PDA / `config` PDA                              | `withdraw_treasury_sol`, `withdraw_treasury_usdc` |
| Core collection update authority | `artist` PDA                                               | `redeem_perk` (mint into collection)              |
| Core asset creation              | `asset` PDA signs its own creation                         | `redeem_perk`                                     |

Every token account is an `InterfaceAccount` with an explicit `token_program`, so a Token-2022 mint works without code changes. The devnet deployment uses the legacy token program.

## 2. Flows

### 2.1 Buy on the curve with SOL

```
buyer --lamports_in--> [fee -> treasury] [net -> sol_vault]
curve: virtual_sol += net, virtual_tokens -= out, real_sol += net, tokens_sold += out
mint_to(buyer_ata, out)     signer: curve PDA
```

`net = (lamports_in - 1) * 10_000 / (10_000 + fee_bps)`, `out = net * VT / (VQ + net)`. The integer formulas follow the MIT-licensed `@pump-fun/pump-sdk`, so a TypeScript quote and the on-chain result agree to the unit. `buy_tokens_exact_out_sol` inverts the formula: `cost = t * VQ / (VT - t) + 1`, `fee = ceil(cost * fee_bps / 10_000)`.

Preconditions: not paused, curve not complete, `now >= sale_start_ts`, and an approved `Kyc` when `config.kyc_required`. A buy that would push `tokens_sold` past `supply_cap` fails with `CurveSoldOut`; there is no partial fill. Reaching the cap exactly sets `complete = true`.

Two signers are declared: `buyer` pays the SOL and receives the tokens; `payer` pays the rent of `buyer_ata` when it has to be created. They are the same key unless a sponsor pays the gas (2.10). `buy_tokens_usdc` has the same pair; there `buyer` only needs to sign (its USDC moves by token authority), and `payer` is the writable account that funds the ATA.

### 2.2 Buy on the curve with USDC

```
price_e6 = sol_usd(config, price_update)           mode 0: config value, mode 1: Pyth
lamports_equiv = usdc_in * 1e9 / price_e6
quote = buy_exact_in(VQ, VT, lamports_equiv)         same curve, same formula
usdc_fee = usdc_in * quote.fee / lamports_equiv
buyer_usdc --usdc_fee--> treasury_usdc
buyer_usdc --usdc_in - usdc_fee--> usdc_vault (ATA of curve)
curve: virtual_sol += quote.net_in, virtual_tokens -= out, real_usdc += usdc_net
mint_to(buyer_ata, out)
```

The curve is quoted in SOL. A USDC buy moves the virtual reserves as if the SOL equivalent had been paid, so the price buyers see is the same in both currencies. The USDC itself stays in `usdc_vault`; `real_sol_reserves` does not change.

### 2.3 Sell on the curve

```
gross = t * VQ / (VT + t); fee = ceil(gross * fee_bps / 10_000)
require gross <= real_sol_reserves
burn(seller_ata, t)                        signer: seller
sol_vault --gross - fee--> seller          signer: sol_vault PDA
sol_vault --fee--> treasury
curve: virtual_sol -= gross, virtual_tokens += t, real_sol -= gross, tokens_sold -= t, complete = false
```

Sells pay out only from SOL that real SOL buys put in. A sell on a complete curve reopens it.

Preconditions: not paused, and an approved `Kyc` for the seller when `config.kyc_required` (the same `check_kyc` the buys run). Sells create no accounts, so the seller is the only signer and there is no `payer`.

### 2.4 Redeem a perk

```
1. gate     !paused, perk.active, artist.active, supply left
2. pass     resolve (pass_asset, pass_perk): both or neither
            tier -> (discount_bps, early_secs, is_vip) from Config
            vip_only  => require is_vip
            require now >= public_start_ts - early_secs
3. price    paid = price - floor(price * discount_bps / 10_000)   (discount only if perk.discount_eligible)
            require paid <= max_paid                                   (SlippageExceeded: caller's price cap)
            (burned, to_rewards, to_artist) = split(paid, perk.burn_bps, perk.rewards_bps)
4. pay      burn(buyer_ata, burned)                       visible as a Burn in explorers
            buyer_ata --to_rewards--> rewards_vault
            buyer_ata --to_artist--> artist_vault
5. mint     Core CreateV2(asset PDA, collection = perk.collection, owner = buyer,
                          name = "{perk.name} #{edition}", uri = perk.uri,
                          plugins = Attributes{kind, tier, artist, edition}, Edition{edition})
            signers: asset PDA + artist PDA (collection update authority)
6. record   Receipt{buyer, perk, artist, asset, edition, paid, burned, to_rewards, to_artist, discount_bps, pass_used, ts}
            perk.sold = edition; curve.total_burned += burned; curve.rewards_accrued += to_rewards; artist.revenue_tokens += to_artist
```

Default split: burn 80%, rewards 20%, artist 0%. Each perk sets its own `burn_bps` and `rewards_bps` within the protocol floors (2.9); the remainder goes to the artist. The edition number is `perk.sold + 1` and lives in the asset plugins and the receipt, not in the asset seed. The seed uses a client nonce so concurrent buyers do not collide and the client knows the asset address before confirmation. The asset's `Attributes` plugin carries `kind`, `tier`, `artist` and `edition`; the perk itself is identified by the collection the asset belongs to and by the receipt, not by an attribute. The collection PDA is `["collection", perk, collection_salt]`, salted by a `u64` the creator passes in `CreatePerkArgs`, so a perk whose collection CPI failed half-way can be recreated under a fresh address; `perk.collection` records the one in use and `redeem_perk` checks it with `has_one`. `max_paid` is the buyer's price cap: `set_perk` can change `price` at any time, and without the cap a buyer who signed against one quote could be charged another.

Signers: `buyer` (spends the tokens, receives the asset) and `payer` (asset rent, receipt rent and the Metaplex Core protocol fee). They are the same key in the self-paid case; a sponsor supplies `payer` (2.10).

### 2.5 Pass benefits enforced on-chain

MoOG Passes are perks of kind `Pass` with tier 0 (Standard) or 1 (VIP). Their collections are ordinary perk collections. On redeem of any other perk, the buyer may present a pass:

| Check                                                             | Error                                                    |
| ----------------------------------------------------------------- | -------------------------------------------------------- |
| `pass_perk.kind == Pass`                                          | `PassMismatch`                                           |
| `pass_asset.owner == buyer`                                       | `InvalidPass`                                            |
| `pass_asset.update_authority == Collection(pass_perk.collection)` | `PassMismatch` (`InvalidPass` if not a collection asset) |
| \1                                                                |
| `pass_perk.active`                                                | `PerkInactive` (a retired pass tier grants nothing)      |

Benefits come from `Config` (defaults: Standard 5% / 24 h, VIP 15% / 72 h) and apply as discount (when `perk.discount_eligible`), early access (`public_start_ts - early_secs`) and VIP-only gating (`perk.vip_only`). Benefits follow the asset: whoever owns the pass now gets them. `receipt.pass_used` records which pass was presented.

### 2.6 KYC attestation gate

`set_kyc(wallet, approved, country)` lets the admin write a `Kyc` PDA after an off-chain identity check. When `config.kyc_required` is true, every curve buy requires the buyer's `Kyc` with `approved == true`, and every curve sell requires the seller's. The gate is symmetric so a wallet that cannot buy cannot exit either; otherwise an unverified wallet could receive tokens by transfer and cash out. Redeems are not gated. The flag is off on devnet; flipping it is one `set_config`.

### 2.7 Admin cool-off

`propose_admin(new)` records `pending_admin` and `admin_transfer_ready_ts = now + admin_cooloff_secs`. `accept_admin` must be signed by the pending admin after that time. `cancel_admin_transfer` clears it. `admin_cooloff_secs` is set once in `initialize_config`. All other `set_config` changes apply immediately.

### 2.8 Price modes

| `config.price_mode` | Source                                                 | Checks                                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 (admin)           | `config.sol_usd_price_e6`, written by `set_config`     | `> 0`; `now - config.price_updated_ts <= max_price_age_secs` (a forgotten admin price expires instead of pricing USDC buys forever)                                                                                                                                      |
| 1 (Pyth)            | the `price_update` account passed to `buy_tokens_usdc` | key == `config.pyth_sol_usd_account`; owner == Pyth receiver program; verification level `Full`; feed id == `config.pyth_feed_id`; `price > 0`; `now - publish_time <= max_price_age_secs`; `conf * 10_000 <= price * 200` (confidence within 2%, else `PriceUncertain`) |

`PriceUpdateV2` is decoded by hand at fixed offsets (price at 73, conf at 81, exponent at 89, publish time at 93) instead of through `pyth-solana-receiver-sdk`. Reason: the SDK versions that build with Anchor 0.32 conflict with `mpl-core` in the same lockfile, and the next major requires Anchor 1.x. The offsets hold only for the `Full` verification level, which is the only one accepted. The `price_update` account is part of the instruction from the first deploy so switching to mode 1 does not change the account list.

### 2.9 Who may create and edit perks; where artist revenue can go

| Rule                                                                                                                | Where                                   | Error                  |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ---------------------- |
| `create_perk` with `kind == Pass` requires `signer == config.admin`                                                 | `perks.rs::create_perk`                 | `Unauthorized`         |
| Every other kind accepts `artist.authority` or `config.admin`                                                       | `ManagePerk` / `CreatePerk` constraints | `Unauthorized`         |
| `burn_bps + rewards_bps <= 10_000`, `burn_bps >= config.min_burn_bps`, `rewards_bps >= config.min_rewards_bps`      | `create_perk` and `set_perk`            | `InvalidBps`           |
| \1                                                                                                                  |
| `set_perk` on a perk with `kind == Pass` requires `signer == config.admin`                                          | `perks.rs::set_perk`                    | `Unauthorized`         |
| `set_artist` with `authority` set requires `signer == artist.authority` (admin may change name / uri / active only) | `artist.rs::set_artist`                 | `Unauthorized`         |
| `initialize_config` funds `treasury` with `Rent::minimum_balance(0)`; `withdraw_treasury_sol` keeps that floor      | `config.rs`                             | `InsufficientReserves` |

Passes grant protocol-wide benefits (discount, early access, VIP gating on every artist's perks), so only the protocol can issue them; an artist cannot mint a "pass" that unlocks another artist's drops. The floors stop an artist from setting a perk to 0% burn / 0% rewards and keeping the whole payment: `min_burn_bps` and `min_rewards_bps` are set in `initialize_config` (0 / 0 on devnet) and changed with `set_config`. They are checked when a perk is created or edited, not retroactively on existing perks. Artist revenue in `artist_vault` is reachable by the artist alone; the admin's reach ends at `treasury` and `treasury_usdc`, and the admin cannot get there by rotating `artist.authority` either, because only the current authority can hand an artist over. Pass perks are admin-owned end to end: created and edited by the admin only. The treasury always keeps its rent-exempt floor so the PDA can never be garbage-collected while fees are still flowing in.

### 2.10 Payer / buyer split (gas sponsorship)

`buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc` and `redeem_perk` declare two signers: `payer` (first) and `buyer`. `payer` is the `payer =` of every `init` / `init_if_needed` in those instructions (`buyer_ata`, `receipt`) and the `.payer()` of the Core `CreateV2` CPI, so it carries rent and the Core protocol fee. Everything else is tied to `buyer`: the lamports or USDC debited, the token account authority, the asset owner, the receipt's `buyer`, the KYC lookup (`["kyc", buyer]`) and the pass ownership check.

In the self-paid case the client passes the same key twice and the transaction has one signature. A sponsor (Openfort's embedded wallet gas policy, or a Kora paymaster) passes its funded key as `payer`, is the transaction fee payer, and co-signs after the buyer. The program only verifies that `payer` signed; what the sponsor agrees to pay for is the sponsor's policy, so it has to inspect the transaction before signing. `sell_tokens` creates nothing and has no `payer`.

## 3. Limitations (current code)

- **USDC buys are not sellable back.** Sells pay only from `real_sol_reserves`. USDC paid into `usdc_vault` sits there; no instruction moves it out yet. A curve bought mostly with USDC can refuse sells with `InsufficientReserves`.
- **Burning does not move the price.** The curve prices on virtual reserves. A redeem burns tokens from the buyer's wallet: `mint.supply` and market cap drop, the spot price does not. `curve.tokens_sold` is not reduced by redeem burns either, so the supply cap counts tokens ever sold on the curve.
- **The rewards vault has no spend path.** `rewards_vault` accrues 20% of every redeem; a `claim_rewards` instruction does not exist yet.
- **Single admin hot key on devnet.** The deployer's keypair is the upgrade authority, the `Config.admin`, and the only signer that can withdraw the treasury. See `SECURITY.md`.
- **Admin-set price in mode 0.** The admin sets the SOL/USD conversion used for USDC buys; it expires after `max_price_age_secs` (USDC buys fail with `PriceTooOld` until `set_config` refreshes it), which bounds staleness but not the value. Mode 1 (Pyth) removes that trust and additionally rejects feeds whose confidence exceeds 2% of the price.
- **Token metadata is a separate admin step.** `create_curve` stores name, symbol and URI in the `Curve` account only; wallets show "Unknown Token" until the admin runs `set_curve_metadata`, which creates the Metaplex Token Metadata account (`["metadata", metaqbx…, mint]`) from those fields with the `curve` PDA as mint and update authority. It succeeds once per mint; the seed runs it after `create_curve`.
- **One URI per perk.** Every asset of a perk points at `perk.uri`; editions differ only by name and attributes.
- **The collection salt is not stored.** `perk.collection` is, so reads are unaffected, but re-deriving a collection address off-chain needs the salt the creator used (the devnet seed records it in `shared/addresses/<cluster>.json`).
- **Admin-only onboarding.** `create_curve` and `create_artist` require the admin. Artists then manage their own perks with their `authority` wallet, except Pass perks, which only the admin creates.
- **`set_config` is immediate.** Only the admin transfer has a cool-off. Fee, pause, price mode, pass benefits and the split floors change in one transaction.
- **Split floors are not retroactive.** Raising `min_burn_bps` / `min_rewards_bps` constrains future `create_perk` / `set_perk` calls; perks created under lower floors keep their split until edited.
- **Sponsorship is a signer, not a policy.** The `payer` split lets a sponsor pay rent and Core fees, but the program does not cap what a sponsor can be charged nor whitelist sponsors; that logic lives in the sponsor's signing service.
- **No partial fills on the cap.** A buy that crosses `supply_cap` fails instead of filling the remainder.

## 4. Roadmap

Ordered by what unblocks the most:

1. Move the admin and the upgrade authority to a Squads multisig; add a timelock for `set_config`.
2. `claim_rewards`: distribute `rewards_vault` to holders or pass owners (design open).
3. A path for the USDC in `usdc_vault`: a USDC sell leg priced through the same SOL/USD source, or an admin sweep into SOL reserves.
4. An `update_curve_metadata` path (`set_curve_metadata` only creates; a URI change in `Curve` does not propagate yet).
5. Per-edition metadata URIs and `update_perk_asset` for fulfilled merch.
6. Permissionless artist onboarding with a creation fee.
7. Migrate to Anchor 1.x once `mpl-core` ships an `anchor-1` feature; generate a kit-native client with Codama.
8. External security audit before any mainnet deploy.
