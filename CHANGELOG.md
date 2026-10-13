# Changelog

All notable changes to this repository. Dates are UTC-3 (Buenos Aires).

## 2026-10-09 (round 2): admin price age, KYC on by default, sponsored redeem, measured costs

- `scripts/demo-one-tx.ts`: the post-card step as ONE transaction (`buy_tokens_exact_out_sol` for the pass price + `redeem_perk`), buyer as the only user signer. Devnet run: 139,061 CU, 878-byte legacy transaction, tx 2T5T4Ctjmby6GyiiKhd4anVMK1r4nrjYeY2M1aBC5wUG6op2mKSCrUNontvhxXGMuzbwB5k6dryVCEqonSTR9pHG, asset wK1JY1qY84DMD7Eax12TwU47vhJK5eBcRTZ8dWGF9zH.
- Review follow-ups on MR !3: `admin_price_max_age_secs` must be > 0 in `initialize_config` and `set_config` (a zero, including the zeroed reserved bytes of a config created before this field, would block every mode-0 USDC buy); `scale_to_e6` uses a checked `6 + expo` so absurd exponents return `MathOverflow` instead of panicking (unit tests added); `scripts/set-config.ts` rejects boolean values other than `true/false/1/0` instead of silently sending `false`; docs: KYC-on-devnet statement in ARCHITECTURE 2.6, priority-fee note (charged on the requested CU limit, not on consumed CU), `PriceTooOld` row, SECURITY admin-trust bullet and `set-price.ts` header updated to the mode-0 limit.
- Integration suite: **28 passing, 0 failing** on a fresh surfpool fork of devnet (`bash scripts/test-local.sh`, run of 2026-10-09 ~10:40 ART), including the sponsor-pays case (`payer != buyer`). Local runner now wipes the cloned devnet program before deploying and bounds each deploy attempt (8 min).

Program upgraded on devnet at slot 509182643 ([explorer](https://explorer.solana.com/address/6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK?cluster=devnet)), IDL upgraded on-chain. `.so` 731,640 bytes (800,000 reserved).

### Changed

- `Config.admin_price_max_age_secs: u32` (taken from `_reserved`, now `[u8; 56]`), `InitializeConfigArgs.admin_price_max_age_secs`, `SetConfigArgs.admin_price_max_age_secs: Option<u32>`. Price mode 0 enforces this limit against `price_updated_ts` (seeded 86,400 s); Pyth mode keeps `max_price_age_secs` (300 s). `pricing.rs::scale_to_e6` uses `checked_pow`. `@mostro/shared`: `PriceConfigLike.adminPriceMaxAgeSecs`, `solUsdFromConfig` applies it in mode 0 (falls back to `maxPriceAgeSecs` for older configs), `DEVNET_PRICE_MAX_AGE`.
- Devnet config: `kyc_required = true`, `admin_price_max_age_secs = 86_400`; admin wallet KYC-approved ([tx](https://explorer.solana.com/tx/3mBnJaChREcNePh4GGKQeXcv8cwJUqeJu2D9pZdDpLsHoHWzJcpvAgV7jqujs6AbmzoEWCoXF1au3VCq4YXfGrwx?cluster=devnet)). Every new wallet must be approved with `scripts/set-kyc.ts <wallet> true GB` before buying or selling `$MOST`; redeems are not gated.

### Added

- `scripts/set-config.ts key=value ...`: generic admin switchboard over `set_config` (keys are the `SetConfigArgs` fields in camelCase).
- `scripts/demo-sponsored.ts [perkIndex]`: a fan wallet that never holds SOL redeems a perk; the CLI wallet signs as `payer` (rent + Core fee), the fan as `buyer`. Devnet run: fan `BENZutuN6MDtLHCYVagZtMWqdr4YncyYcZ92oMJo8sfQ`, [funding tx](https://explorer.solana.com/tx/3wTmLSFmSsFFAdKwzK65w1mFazXiNAXFQhQFHWxfLZ3RFnZ29QBcVWTk9pSGRWF633oJh67stmWvpgRVC9DhRJnx?cluster=devnet), [redeem tx](https://explorer.solana.com/tx/4kb1hVAH1dPvM8dBrB2ZumCddM62aSe46mkS7X51cqfCSeh8QDP9Xz5RSRGbY9bDtUq2cs5TLhQ1fbFgyDnbTBZJ?cluster=devnet), asset [`6Y93pRA2N2WferK9iw1t7CDUoWjpmTrDMwUVUZ9NC49c`](https://explorer.solana.com/address/6Y93pRA2N2WferK9iw1t7CDUoWjpmTrDMwUVUZ9NC49c?cluster=devnet); fan SOL balance 0 before and after.
- Measured on devnet ([redeem with the 5% pass discount](https://explorer.solana.com/tx/3gAt6NB9cNwr8bf3UpoqMmens4vzYu3AocQAHTsbT5csRBqH6GvgEhCApTdp2u1yBf7VcUsWX9KX6BX3Hq5AAH6o?cluster=devnet), pass asset [`8V69nD…83q6m`](https://explorer.solana.com/address/8V69nDgc24kERDDyMLQgeGAjNttxUa4KZBwJLXT83q6m?cluster=devnet)): `redeem_perk` 109,290 CU total (program 108,990; Core `CreateV2` 25,116); payer cost 0.00544748 SOL = receipt rent 0.00196596 + Core asset rent and fee 0.00347612 + transaction fee. FRONTEND.md and the READMEs now carry these instead of estimates.
- Docs: FRONTEND.md "Devnet state" table and KYC onboarding steps; ARCHITECTURE.md 2.11 "Regulatory design" (gate scope, pause scope, admin powers, no PII, country not enforced) and the "can I get my money back?" answer; limitations for placeholder metadata URIs, `set_perk(max_supply)` not updating the collection `MasterEdition`, single admin hot key.

## 2026-10-09: devnet deployment

- Program `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK` deployed to devnet (slot 509161236, 800 000 bytes reserved), IDL published on-chain.
- Seeded: `$MOST` curve #0 with token metadata, artist #0 "MoOG", perks #0-#4 (Pass Standard, Pass VIP, Unreleased track, Listening session, Numbered tee). Addresses in `shared/addresses/devnet.json`.
- End-to-end check on devnet: buy `$MOST` with SOL, redeem the Standard pass (burn 960 / rewards 240), redeem the music perk with the 5 % pass discount. Pass asset `8V69nDgc24kERDDyMLQgeGAjNttxUa4KZBwJLXT83q6m`.

## 2026-10-09: redeem price cap, salted collections, oracle hardening

Breaking IDL change (21 instructions, 32 errors, 17 events); same program id. `shared/`, `scripts/` and the docs were resynced in the same change.

### Changed

- `redeem_perk(nonce: u64, max_paid: u64)`: new second argument. The program fails with `SlippageExceeded` when the effective price (after the pass discount) exceeds `max_paid`, so a `set_perk` price change cannot overcharge a transaction signed against an older quote. The price is deterministic: clients pass exactly the expected amount. `@mostro/shared`: `RedeemPerkParams.maxPaid` (required), `derived.maxPaid`, `expectedPaid(config, perk, passTier)` and `prepareRedeemPerk(...)` which fills `maxPaid`, `collection` and `artist` from the fetched perk. `demo-buy.ts` passes the quoted price.
- `CreatePerkArgs.collection_salt: u64` (new last field): the collection PDA is `["collection", perk, collection_salt LE]`. `collectionPda(perk, salt)` in the SDK and the scripts; `buildCreatePerk` takes `args.collectionSalt` (default `DEFAULT_COLLECTION_SALT = 1`); `buildRedeemPerk` accepts `collection` (preferred, from `perk.collection`) or `collectionSalt`. `summarizePerk` and `passPerkRefs` read `perk.collection` instead of re-deriving. The seed uses salt 1 for every perk and records `collectionSalt` per perk in `shared/addresses/<cluster>.json`.
- `kyc` on `buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc`, `sell_tokens` has no PDA seeds in the IDL any more; Anchor clients omit it or pass `null`, and pass the wallet's `Kyc` PDA when the gate is on. SDK builders unchanged (`kyc: true` still derives it).
- `set_perk` on a Pass perk is admin-only; `set_artist` may set `authority` only when signed by the current authority (admin edits name / uri / active). `canSetPerk`, `canSetArtist` added next to `canCreatePerk`.
- `resolve_pass` requires the pass perk to be active (`PerkInactive`). `PassPerkRef` / `FoundPass` carry `active`; `findPassForBuyer` skips inactive tiers; `redeemEligibility` takes `passPerkActive` and returns `PassPerkInactive`.
- Price mode 0 enforces `max_price_age_secs` against `config.price_updated_ts` (`PriceTooOld`); `solUsdFromConfig` mirrors it when `priceUpdatedTs` is given, and `set-price.ts` prints the admin price age and warns when stale. Price mode 1 rejects a Pyth confidence above 2% of the price with the new error `PriceUncertain` (6031); mirrored in `solUsdFromConfig` (`MAX_PRICE_CONF_BPS = 200`).
- `initialize_config` funds the treasury PDA with the rent floor and `withdraw_treasury_sol` keeps it (`InsufficientReserves` otherwise).
- Core asset `Attributes`: `kind`, `tier`, `artist`, `edition` (as in the previous entry).

### Added

- Events `AdminTransferCancelled { admin, cancelled }`, `TreasuryWithdrawn { destination, amount, usdc }`, `ArtistUpdated { artist, authority, active }`, `ArtistVaultWithdrawn { artist, mint, destination, amount }`, `PerkUpdated { perk, artist, price, active, max_supply, public_start_ts, vip_only, discount_eligible, burn_bps, rewards_bps }`.
- Error `PriceUncertain` (6031) with UI copy in `errors.ts`.
- Tests: `max_paid` encoding, salted collection derivation, `prepareRedeemPerk`, no-seeds `kyc`, access helpers, `PriceUncertain` / admin-price expiry, event and error counts.

## 2026-10-08 (later): access rules, split floors, sponsored payer

Breaking IDL change over the entry below; same program id. `shared/idl`, `shared/types`, `@mostro/shared`, `scripts/` and the docs were resynced in the same change. `Config` keeps its size (`_reserved` 64 -> 60 bytes).

### Changed

- `buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc`, `redeem_perk`: a `payer` signer is now the first account, before `buyer`. `payer` funds the created accounts (`buyer_ata`, `receipt`, Core asset) and the Metaplex Core protocol fee; `buyer` still pays the trade and receives tokens / asset. Self-paid flows pass the same key twice; a gas sponsor (Openfort, Kora) passes its own key and co-signs. `@mostro/shared` builders take an optional `payer` (default: buyer) and expose `derived.payer`.
- `sell_tokens`: optional `kyc` account appended after `seller_ata`. When `config.kyc_required` is on, sells need the seller's approved `Kyc`, same as buys.
- `withdraw_artist_vault`: accounts are now `authority` (signer, `has_one` on `Artist`), `artist`, `mint`, `artist_vault`, `destination`, `token_program`. The `config` account and the admin path are gone: only the artist authority can withdraw. `buildWithdrawArtistVault` takes `authority` instead of `signer`.
- `create_perk` with `kind == Pass` is admin-only (`Unauthorized` for an artist authority). Other kinds still accept the artist authority or the admin.
- `create_perk` and `set_perk` enforce `burn_bps >= config.min_burn_bps` and `rewards_bps >= config.min_rewards_bps` in addition to `burn + rewards <= 10_000` (`InvalidBps`).
- Core asset `Attributes` no longer include a `perk` entry; `kind`, `tier`, `artist`, `edition` remain. The perk is identified by the asset's collection or its receipt.

### Added

- `set_curve_metadata` (admin-only, no args; 2026-10-09 07:29 IDL, 21 instructions). Accounts: `admin`, `config`, `curve`, `mint`, `metadata` (`["metadata", token_metadata_program, mint]` under `metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s`), `token_metadata_program`, `system_program`, `rent`. Creates the Metaplex Token Metadata of the curve mint from `curve.name` / `symbol` / `uri` with the `curve` PDA as mint and update authority, so wallets show the symbol. Succeeds once per mint. `@mostro/shared`: `buildSetCurveMetadata`, `metadataPda`, `TOKEN_METADATA_PROGRAM_ID`; `seed-devnet.ts` runs it after `create_curve` when the metadata account is missing.
- `InitializeConfigArgs.min_burn_bps` / `min_rewards_bps` (`u16`), `SetConfigArgs.min_burn_bps?` / `min_rewards_bps?`, and the two fields on `Config`. The devnet seed writes 0 / 0 and keeps the per-perk default of 8000 / 2000; `shared/addresses/<cluster>.json` now carries `splitFloors`.
- `@mostro/shared`: `checkPerkSplit`, `canCreatePerk`, `DEFAULT_SPLIT_FLOORS`; tests for the payer split, the sell-side `kyc`, the new `withdraw_artist_vault` shape and the config fields.
- Docs: payer/buyer split and how a sponsor uses it (FRONTEND.md 4.2, ARCHITECTURE.md 2.10), perk access rules and floors (ARCHITECTURE.md 2.9), new rows in the SECURITY.md model.

## 2026-10-08: initial Solana program

Program `mostro` (Anchor 0.32.1), id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`, targeting devnet.

### Added

- `Config` PDA: admin with cool-off transfer, pause switch, protocol fee (bps, max 10%). SOL/USD price source: admin value or Pyth `PriceUpdateV2`. KYC requirement flag. MoOG Pass benefits (default Standard 5% / 24 h, VIP 15% / 72 h).
- Bonding curve (`Curve` PDA per mint) with constant-product virtual reserves, supply cap, and `$MOST` mint PDA (6 decimals): `create_curve`, `buy_tokens_sol`, `buy_tokens_exact_out_sol`, `buy_tokens_usdc`, `sell_tokens`. Fees go to a treasury PDA (SOL) or the config's USDC ATA.
- Artists (`Artist` PDA) with an authority wallet and a per-mint vault: `create_artist`, `set_artist`, `withdraw_artist_vault`.
- Perks (`Perk` PDA) of kind Pass, Music, Event or Merch, each with its own Metaplex Core collection: `create_perk`, `set_perk`, `redeem_perk`, `fulfill_receipt`. Redeem burns part of the payment, routes the rest to the rewards vault and the artist vault, mints a Core asset with `Attributes` and `Edition` plugins to the buyer, and writes a `Receipt` PDA.
- On-chain pass benefits in `redeem_perk`: discount, early access and VIP-only gating, checked against a Core asset the buyer owns.
- KYC attestation (`Kyc` PDA) written by the admin with `set_kyc`; curve buys require it when `config.kyc_required`.
- Treasury withdrawals: `withdraw_treasury_sol`, `withdraw_treasury_usdc`.
- Unit tests for curve math and SOL/USD pricing; Anchor IDL and TypeScript types in `target/`.
- Documentation: `programs/mostro/docs/ARCHITECTURE.md`, `programs/mostro/docs/FRONTEND.md`, `programs/mostro/README.md`, `SECURITY.md`.

### Known limitations

See the "Limitations" section of `programs/mostro/docs/ARCHITECTURE.md`: USDC buys cannot be sold back, burns do not move the curve price, the rewards and USDC vaults have no spend path yet, and a single admin hot key is used on devnet.
