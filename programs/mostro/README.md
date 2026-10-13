# mostro (Solana program)

Anchor 0.32.1 program. Program id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK` on localnet and devnet (see `Anchor.toml`).

What it does: a bonding curve that mints `$MOST` for SOL or USDC, artists that open perks priced in `$MOST`, and a `redeem_perk` flow that burns part of the payment and mints a Metaplex Core asset to the buyer. MoOG Pass holders get on-chain discounts, early access and VIP-only gating.

Access rules worth knowing before you script against it: Pass perks are created by the protocol admin only; artists create Music / Event / Merch perks whose burn / rewards split must meet `config.min_burn_bps` / `min_rewards_bps`; only `artist.authority` can withdraw an artist vault; the KYC gate (when on) covers buys and sells; buys and redeems take a `payer` signer separate from `buyer` so a sponsor can cover rent and Core fees (defaults to the buyer).

Docs: [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) (accounts and flows), [`../docs/FRONTEND.md`](../docs/FRONTEND.md) (client handoff), [`../../SECURITY.md`](../../SECURITY.md).

## Layout

```
programs/mostro/
├── Cargo.toml
└── src/
    ├── lib.rs            declare_id!, #[program] entry points
    ├── state.rs          Config, Curve, Artist, Perk, Receipt, Kyc, seeds and constants
    ├── errors.rs         MostroError (6000..6030)
    ├── events.rs         Anchor events
    ├── curve.rs          constant-product math, split and discount (pure, unit-tested)
    ├── pricing.rs        SOL/USD: admin price or Pyth PriceUpdateV2 decode (pure, unit-tested)
    └── instructions/
        ├── config.rs     initialize_config, set_config, admin transfer, set_kyc, treasury withdrawals
        ├── trading.rs    create_curve, set_curve_metadata, buy_tokens_sol, buy_tokens_exact_out_sol, buy_tokens_usdc, sell_tokens
        ├── artist.rs     create_artist, set_artist, withdraw_artist_vault
        └── perks.rs      create_perk, set_perk, redeem_perk, fulfill_receipt
```

## Toolchain

| Tool               | Version                        |
| ------------------ | ------------------------------ |
| Rust               | 1.89.0 (`rust-toolchain.toml`) |
| Solana CLI (Agave) | 3.1.12                         |
| anchor-cli         | 0.32.1                         |
| Node               | >= 24                          |

Dependencies: `anchor-lang =0.32.1` (with `init-if-needed`), `anchor-spl =0.32.1`, `mpl-core 0.12.1` (`anchor`, `anchor-0-32` features). No Pyth crate: `pricing.rs` decodes the account by hand.

## Commands

Run from the repository root.

```bash
# Build the program and regenerate target/idl/mostro.json and target/types/mostro.ts
anchor build

# Rust unit tests for curve.rs and pricing.rs
cargo test -p mostro --lib

# Integration tests (tests/**/*.ts) against a local validator you start yourself
yarn test:programs
# or let Anchor start the validator
anchor test

# Deploy to the cluster in Anchor.toml (devnet)
anchor deploy

# Upload or upgrade the on-chain IDL so explorers decode transactions
anchor idl init  6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK -f target/idl/mostro.json --provider.cluster devnet
anchor idl upgrade 6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK -f target/idl/mostro.json --provider.cluster devnet

# Copy IDL and types into the shared workspace package
yarn export:shared

# Seed devnet: config, $MOST curve, demo artist and perks
yarn seed:devnet

# Admin operations (CLI wallet must be config.admin)
npx ts-node scripts/set-kyc.ts <wallet> true GB        # KYC-approve a wallet; required on devnet before it can buy or sell
npx ts-node scripts/set-config.ts key=value [...]      # any SetConfigArgs field, camelCase (kycRequired, paused, feeBps, adminPriceMaxAgeSecs, ...)
npx ts-node scripts/set-price.ts <0|1> [priceUsd]      # price source; mode 0 price expires after admin_price_max_age_secs

# Demos
npx ts-node scripts/demo-buy.ts [sol=0.1]              # buy, redeem the Standard pass, redeem the music perk with the discount
npx ts-node scripts/demo-sponsored.ts [perkIndex=0]    # fresh fan wallet with 0 SOL; CLI wallet is `payer`, fan is `buyer`
```

Before `anchor deploy` on an existing program whose binary grew, run `solana program extend 6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK <extra_bytes>`. Current `.so`: 731,640 bytes; 800,000 reserved on devnet, so about 68 KB of headroom remain.

Devnet state after the slot 509182643 upgrade: IDL on-chain, `kyc_required = true` (approve wallets with `set-kyc.ts` first), `admin_price_max_age_secs = 86_400`, admin wallet KYC-approved. Measured `redeem_perk`: 109,290 CU (Core `CreateV2` 25,116), payer cost 0.00544748 SOL.

`initialize_config` must be signed by the program's upgrade authority. Deploy from the same keypair you seed with. The seed also uses that keypair as `config.admin` and as artist #0's authority, which is why one wallet can create the two Pass perks (admin-only) and the three artist perks in a single run; it writes split floors of 0 / 0 and keeps 8000 / 2000 per perk.

## Program id

The id comes from `target/deploy/mostro-keypair.json`. Keypair files are gitignored. If you build from a fresh clone without that keypair, `anchor keys sync` would change the id; do not run it unless you intend to deploy a separate instance.
