# mostro-solana

Mostro on Solana. Two layers only: on-chain programs and frontends. There is no backend.

## Layout

```
.
├── programs/          # Solana programs (Rust)
├── shared/            # Shared TypeScript types and program IDLs used by the frontends
└── fronts/
    ├── front-nuxt/    # Nuxt app
    ├── front-vue/     # Vue SPA
    ├── front-openfort/# Openfort wallet integration
    └── ui/            # Shared UI components
```

## Branches

- `develop` is the integration branch. Open merge requests against it.
- `main` holds released code.

## Requirements

- Node 24 (see `.nvmrc`)
- Rust and the Solana toolchain for `programs/`

## Solana programs

The on-chain side lives in `programs/mostro` (Anchor 0.32.1, program id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`, devnet). It holds the `$MOST` bonding curve, artists, perks and the MoOG Pass redemption flow. Buys and redeems take a `payer` signer separate from the buyer (same key by default) so a sponsor such as Openfort or Kora can cover rent and Metaplex Core fees; Pass perks are admin-only, artist vaults are withdrawable by the artist alone, and the optional KYC gate covers buys and sells.

Toolchain: Rust 1.89.0 (`rust-toolchain.toml`), Solana CLI 3.1.12, anchor-cli 0.32.1, Node 24.

```bash
yarn install                   # root workspace (Anchor TS client, test tooling)
anchor build                   # programs/mostro -> target/deploy, target/idl, target/types
yarn test:unit                 # cargo test -p mostro --lib (curve and pricing math)
yarn test:programs             # integration suite on a fresh surfpool fork of devnet (scripts/test-local.sh)
anchor deploy                  # cluster from Anchor.toml (devnet)
yarn export:shared             # copy IDL and types into shared/
yarn seed:devnet               # initialize config, $MOST curve, demo artist and perks
npx ts-node scripts/set-kyc.ts <wallet> true GB      # approve a wallet (kyc_required is on: needed before any buy/sell)
npx ts-node scripts/set-config.ts key=value ...      # admin switchboard: kycRequired, paused, feeBps, adminPriceMaxAgeSecs, ...
npx ts-node scripts/set-price.ts <0|1> [priceUsd]    # SOL/USD source; refreshes the admin price (expires after 24 h)
npx ts-node scripts/demo-buy.ts [sol]                # buy, redeem a pass, redeem a perk with the pass discount
npx ts-node scripts/demo-sponsored.ts [perkIndex]    # fan wallet with 0 SOL redeems a perk; the CLI wallet pays as `payer`
```

Devnet status (2026-10-09): program [`6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`](https://explorer.solana.com/address/6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK?cluster=devnet) with the IDL on-chain, `.so` 731,640 of 800,000 reserved bytes. `kyc_required = true`, so every new wallet must be approved with `set-kyc.ts` before buying or selling; redeems are not gated. Admin SOL/USD price valid 24 h (`admin_price_max_age_secs = 86_400`). Measured `redeem_perk`: 109,290 CU, 0.00544748 SOL charged to the payer. Reference transactions: [redeem with the pass discount](https://explorer.solana.com/tx/3gAt6NB9cNwr8bf3UpoqMmens4vzYu3AocQAHTsbT5csRBqH6GvgEhCApTdp2u1yBf7VcUsWX9KX6BX3Hq5AAH6o?cluster=devnet), [pass asset](https://explorer.solana.com/address/8V69nDgc24kERDDyMLQgeGAjNttxUa4KZBwJLXT83q6m?cluster=devnet), [sponsored redeem by a 0-SOL wallet](https://explorer.solana.com/tx/4kb1hVAH1dPvM8dBrB2ZumCddM62aSe46mkS7X51cqfCSeh8QDP9Xz5RSRGbY9bDtUq2cs5TLhQ1fbFgyDnbTBZJ?cluster=devnet).

Documentation:

- [`programs/mostro/docs/ARCHITECTURE.md`](programs/mostro/docs/ARCHITECTURE.md): accounts, flows, on-chain pass benefits, limitations, roadmap.
- [`programs/mostro/docs/FRONTEND.md`](programs/mostro/docs/FRONTEND.md): handoff for the apps: PDAs, instructions and account order, read patterns, costs, error codes.
- [`programs/mostro/README.md`](programs/mostro/README.md): build, test and deploy commands.
- [`SECURITY.md`](SECURITY.md): security model, authorities, how to report.
- [`CHANGELOG.md`](CHANGELOG.md).

Frontends import the program id, PDAs, IDL and types from the `shared` workspace package (`shared/addresses/devnet.json`, `shared/idl/mostro.json`, `shared/types/mostro.ts`) and never copy constants by hand.

### Design rationale (the questions judges ask first)

- **Why a bonding curve for a membership product?** The curve is fan capital formation and price discovery for `$MOST`; the perks are access rights with a fixed `$MOST` price and tier benefits the program enforces. The two are decoupled on purpose: redeeming a perk burns part of the payment and routes the rest, it never trades against the curve, so a demo of the money shot does not depend on curve liquidity.
- **Why not Meteora DBC or Raydium LaunchLab?** Neither exposes a per-perk burn / rewards / artist split or a KYC gate on the trading path, and DBC's licence is non-commercial. The curve is ~250 lines of integer math that mirrors the MIT-licensed pump-sdk formulas, with the same rounding in `shared/src/curve.ts` so quotes match on-chain results to the unit. Graduation to an AMM is on the roadmap.
- **Where does the KYC data live?** Off-chain, at the identity provider. On-chain there is only `Kyc { approved, country, updated_ts }` per wallet, written by the admin after the check. No PII touches the chain.
- **What stops an artist from minting itself a VIP pass?** Pass perks are admin-only; the program verifies a presented pass against the pass perk's Core collection and the buyer as owner. See `tests/mostro.ts`.
- **Who pays the ~0.006 SOL of rent and Core fee when the wallet is empty?** The `payer` signer, which is separate from `buyer` in every user instruction. Self-paid by default; a sponsor (Openfort, Kora) co-signs in production.
- **Does burning move the price?** No. The curve prices on virtual reserves; burns reduce supply and market cap, not the spot price. Documented in `programs/mostro/docs/ARCHITECTURE.md`.
