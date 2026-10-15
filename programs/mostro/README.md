# mostro (Solana program)

Anchor 0.32.1 program. Program id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK` on localnet and devnet (see `Anchor.toml`).

What it does: one token per artist with a fixed 1B supply (28 % sold on a buy-only bonding curve, 7 % DEX reserve, 15 % Mostro reserve, 50 % artist reserve), cold reserves and the treasury behind a weighted multisig, a 24 h launch cool-down, a blacklist, a per-wallet monthly SOL cap, and perks paid in tokens (`redeem_perk`) or in SOL (`buy_perk_sol`, half curve / half artist reserve) that burn 80 % of the tokens involved, send 20 % to a rewards vault and mint a Metaplex Core asset to the buyer. Pass benefits are applied by the web app, not on-chain.

Access rules worth knowing before you script against it: the admin is an operator key (fees, breakers, blacklist, onboarding) with no path to any vault; vault and treasury transfers and membership changes are governance proposals (members weigh 1 or 2, execution needs > 51 % of the total weight); Pass perks are created by the admin only; artists create Music / Event / Merch perks and receive SOL directly on hybrid sales; buys and both perk instructions take a `payer` signer separate from `buyer` so a sponsor can cover rent and Core fees (defaults to the buyer), and always pass the buyer's `["blacklist", buyer]` PDA.

Docs: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (accounts and flows), [`docs/FRONTEND.md`](docs/FRONTEND.md) (client handoff), [`../../SECURITY.md`](../../SECURITY.md).

## Layout

```
programs/mostro/
├── Cargo.toml
└── src/
    ├── lib.rs                 declare_id!, #[program] entry points
    ├── state.rs               accounts, seeds, fixed constants (supply split, 80/20, 51 %)
    ├── errors.rs              MostroError (6000..6041)
    ├── events.rs              Anchor events (21)
    ├── curve.rs               constant-product buy math, fixed split, hybrid halves (pure, unit-tested)
    ├── pricing.rs             SOL/USD: admin price or Pyth PriceUpdateV2 decode (pure, unit-tested)
    └── instructions/
        ├── config.rs          initialize_config, set_config, emergency_pause, admin transfer, set_blacklist
        ├── governance.rs      create/approve/cancel_proposal, execute_token_transfer, execute_sol_transfer, execute_set_member
        ├── trading.rs         create_curve (mint + vaults + metadata + revoke), buy_tokens_sol, buy_tokens_exact_out_sol, buy_tokens_usdc
        ├── artist.rs          create_artist, set_artist
        └── perks.rs           create_perk, set_perk, redeem_perk, buy_perk_sol, fulfill_receipt
```

## Toolchain

| Tool               | Version                        |
| ------------------ | ------------------------------ |
| Rust               | 1.89.0 (`rust-toolchain.toml`) |
| Solana CLI (Agave) | 3.1.12                         |
| anchor-cli         | 0.32.1                         |
| surfpool           | 1.0.0-rc1 (local test fork)    |
| Node               | >= 24                          |

Dependencies: `anchor-lang =0.32.1` (with `init-if-needed`), `anchor-spl =0.32.1` (`metadata` feature), `mpl-core 0.12.1` (`anchor`, `anchor-0-32` features). No Pyth crate: `pricing.rs` decodes the account by hand.

## Commands

Run from the repository root.

```bash
# Build the program and regenerate target/idl/mostro.json and target/types/mostro.ts
anchor build

# Rust unit tests: curve math, split, threshold, allocations, pricing
cargo test -p mostro --lib

# Integration suite (tests/mostro.ts) on a fresh surfpool fork of devnet. The program is injected into the
# fork with scripts/surfpool-load-program.js (instant) instead of a chunked deploy.
bash scripts/test-local.sh              # builds first
bash scripts/test-local.sh --skip-build

# Deploy to the cluster in Anchor.toml (devnet). See "Upgrading devnet" first.
anchor deploy

# Upload or upgrade the on-chain IDL so explorers decode transactions
anchor idl init  6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK -f target/idl/mostro.json --provider.cluster devnet
anchor idl upgrade 6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK -f target/idl/mostro.json --provider.cluster devnet

# Copy IDL and types into the shared workspace package
yarn export:shared

# Seed devnet: config (admin = founding super-admin), artist #0, its token, six perks; writes shared/addresses/devnet.json
yarn seed:devnet
LAUNCH_COOLDOWN_SECS=60 MAX_SPEND_SOL_PER_MONTH=5 yarn seed:devnet   # demo-friendly cool-down and a 5 SOL cap

# Admin operations (CLI wallet must be config.admin)
npx ts-node scripts/set-blacklist.ts <wallet> true|false   # block / unblock a wallet
npx ts-node scripts/set-config.ts key=value [...]          # buysPaused, redeemsPaused, feeBps, launchCooldownSecs, maxSpendPerPeriodLamports, ...
npx ts-node scripts/set-price.ts <0|1> [priceUsd]          # price source; mode 0 price expires after admin_price_max_age_secs

# Governance (CLI wallet must be a member)
npx ts-node scripts/governance.ts members
npx ts-node scripts/governance.ts propose-member <wallet> <0|1|2>
npx ts-node scripts/governance.ts propose-transfer artist_reserve <tokenAccount> 1000000 [curveIndex]
npx ts-node scripts/governance.ts propose-transfer treasury_sol <wallet> 0.5
npx ts-node scripts/governance.ts approve|execute|cancel <proposalIndex>
npx ts-node scripts/governance.ts pause                    # emergency: stop buys and redeems

# Demos
npx ts-node scripts/demo-buy.ts [sol=0.1]                 # buy, redeem the Classic pass with tokens, buy the hybrid drop with SOL
npx ts-node scripts/demo-sponsored.ts [perkIndex=0]       # fresh fan wallet with 0 SOL; CLI wallet is `payer`, fan is `buyer`
npx ts-node scripts/demo-one-tx.ts [perkIndex=0]          # buy exact tokens + redeem the pass in one transaction
```

`initialize_config` must be signed by the program's upgrade authority. Deploy from the same keypair you seed with. The seed also uses that keypair as `config.admin`, as the founding super-admin and as artist #0's authority, which is why one wallet can create the two Pass perks (admin-only) and the four artist perks in a single run.

## Upgrading devnet

The devnet program account currently reserves 800,000 bytes; this build is 898,712 bytes. Before `anchor deploy` on the existing program id:

```bash
solana program extend 6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK 150000 -u devnet   # or any value >= 98,712
anchor deploy
anchor idl upgrade 6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK -f target/idl/mostro.json --provider.cluster devnet
```

Account layouts changed (`Config`, `Curve`, `Artist`, `Perk`, `Receipt` are version 2; `Kyc` is gone) and every PDA of the old deployment (`config`, `curve` #0, `mint` #0, the vaults) already exists on devnet under this program id, so `initialize_config` and `create_curve` would fail on the existing accounts. **Deploy this version under a fresh program id**: generate a new keypair, update `declare_id!`, `Anchor.toml`, `shared/src/constants.ts` and the tests' constants, then `anchor build`, `anchor deploy`, `anchor idl init`, `yarn seed:devnet`, `yarn export:shared`. (Closing the old program and redeploying under the same id does not free the old token accounts and mint.) Public devnet RPC rate-limits large deploys: deploy via TPU (no `--use-rpc`) with a saved `--buffer` keypair so it can resume.

## Program id

The id comes from `target/deploy/mostro-keypair.json`. Keypair files are gitignored. If you build from a fresh clone without that keypair, `anchor keys sync` would change the id; do not run it unless you intend to deploy a separate instance.
