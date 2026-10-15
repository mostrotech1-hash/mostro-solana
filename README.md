# mostro-solana

Mostro on Solana: on-chain programs, a web front, and a small API (`back/`) that only handles what a browser cannot: the users table, avatars, signing the MoonPay link and the Openfort wallet recovery session. Passes and wallets live on the blockchain, not in the database.

## Layout

```
.
├── programs/          # Solana programs (Rust)
├── shared/            # Shared TypeScript: program SDK + IDLs, and API types (`@mostro/shared/api`)
├── back/              # NestJS API (use-case folders): users, avatars, MoonPay, wallet recovery session
├── database/flyway/   # SQL migrations (Flyway)
├── docker-local/      # Postgres + Flyway for local development
├── scripts/           # Devnet scripts (Solana) and `dev-fronts.mjs` (starts the fronts)
└── fronts/
    ├── front-nuxt/    # Nuxt app: sign in, Openfort Solana wallet, pass purchase with MoonPay
    └── ui/            # Shared UI kit (Nuxt layer: Ui* components, design tokens, logos, favicon)
```

## The user flow (front-nuxt)

1. **Sign in** with Google, Apple, X or an email code (six boxes). A Mostro wallet is created on Solana automatically (Openfort embedded wallet, automatic recovery, no password).
2. **Profile**: display name and optional picture, saved by the API (`mostro_app.users`, avatars in `back/storage/avatars/<userId>/`).
3. **The pass**: "Buy with SOL" opens the confirmation, "Confirm and pay" opens the **MoonPay** card window. The only way to pay is by card: MoonPay delivers SOL to the user's own wallet.
4. **Paying / still working / success / cancelled**: the screens after the card payment. The step that uses that SOL to mint the pass through the bonding curve is **not connected yet**: it is a stub in `fronts/front-nuxt/app/utils/pass-purchase.ts`, with a comment that says what to fill in. The success screen opens only after that step returns `confirmed`; in development, `/pass/success?preview=1` shows it with placeholder data for design review.

Network: Solana devnet. MoonPay test mode only offers native SOL and delivers 1/100th of the quoted amount.

## Run it locally

Needs Node 24, yarn and Docker Desktop running. Run everything from the repo root.

```bash
yarn install                                   # all workspaces

# 1. Environment files. Copy each example, then fill in the keys (see the comments inside).
cp back/.env.example back/.env                              # secrets: Openfort, Shield, MoonPay, database url
cp fronts/front-nuxt/.env.example fronts/front-nuxt/.env    # PUBLISHABLE keys only

# 2. Database
yarn db:up                                     # Postgres on localhost:45434 (Docker)
yarn db:migrate                                # Flyway: creates mostro_db and the users table

# 3. API and fronts (two terminals)
yarn dev:back                                  # http://localhost:3100
yarn dev:fronts                                # http://localhost:4200 (starts every front that has a `dev` script)
```

Stop the database with `yarn db:down` (data is kept in `docker-local/docker-data`, git-ignored). Check everything compiles with `yarn typecheck`.

Keys to fill in:

| Where                    | Key                                                                          | From                                                      |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `fronts/front-nuxt/.env` | `NUXT_PUBLIC_OPENFORT_PUBLISHABLE_KEY`, `NUXT_PUBLIC_SHIELD_PUBLISHABLE_KEY` | Openfort dashboard (publishable keys only)                |
| `back/.env`              | `OPENFORT_PUBLISHABLE_KEY`, `OPENFORT_SECRET_KEY`                            | Openfort dashboard, **same project as the front**         |
| `back/.env`              | `SHIELD_API_KEY`, `SHIELD_API_SECRET`, `SHIELD_ENCRYPTION_SHARE`             | Openfort dashboard, Embedded wallet keys (Shield)         |
| `back/.env`              | `MOONPAY_API_KEY`, `MOONPAY_SECRET_KEY`                                      | MoonPay dashboard, Developers (use the sandbox `pk_test`) |
| `back/.env` (local only) | `MOONPAY_DEV_CLIENT_IP`                                                      | Your public IP, from https://api.ipify.org                |

- The Shield **publishable key** is `SHIELD_API_KEY` in the back and `NUXT_PUBLIC_SHIELD_PUBLISHABLE_KEY` in the front: the same value. The Shield secret and the encryption share go only in `back/.env`.
- Secret keys (`sk_...`, Shield secret and share, MoonPay secret) go only in `back/.env`, never in the front. The two `OPENFORT_...` publishable keys must be identical, or the API rejects the login ("Invalid or expired session").
- `MOONPAY_DEV_CLIENT_IP` is needed because MoonPay checks the buyer's IP and the API only sees `localhost` on your machine. If your IP changes, update it.
- In the Openfort dashboard: enable the Email, Google, Apple and X providers, add `http://localhost:4200/oauth/callback` as an allowed redirect URL, and enable Solana and automatic recovery for embedded wallets.
- Restart the API or the front after editing a `.env`.

## Branches

- `develop` is the integration branch. Open merge requests against it.
- `main` holds released code.

## Requirements

- Node 24 (see `.nvmrc`)
- Rust and the Solana toolchain for `programs/`

## Solana programs

The on-chain side lives in `programs/mostro` (Anchor 0.32.1, program id `6rXQuWPi6rYC5EUPYhRMB9L5sjJo6mcYFCMZH6osZDPK`, devnet). It implements the contract logic agreed in the 2026-10-13 review: one token per artist with a fixed 1B supply (28 % sold on a buy-only bonding curve, 7 % DEX reserve, 15 % Mostro reserve, 50 % artist reserve), cold reserves and the treasury behind a weighted multisig (admins weigh 1, super-admins 2, execution needs more than 51 %), a 24 h launch cool-down, a blacklist instead of on-chain KYC, a per-wallet monthly SOL cap, two circuit breakers, and perks paid in tokens or in SOL (half curve, half artist reserve) that burn 80 % of the tokens involved and send 20 % to a rewards vault before minting a Metaplex Core asset. Pass benefits are applied by the web app. Buys and perk purchases take a `payer` signer separate from the buyer (same key by default) so a sponsor such as Openfort or Kora can cover rent and Core fees.

Toolchain: Rust 1.89.0 (`rust-toolchain.toml`), Solana CLI 3.1.12, anchor-cli 0.32.1, surfpool 1.0.0-rc1, Node 24.

```bash
yarn install                   # root workspace (Anchor TS client, test tooling)
anchor build                   # programs/mostro -> target/deploy, target/idl, target/types
yarn test:unit                 # cargo test -p mostro --lib (curve, split, threshold, pricing)
yarn test:programs             # integration suite on a fresh surfpool fork of devnet (scripts/test-local.sh)
anchor deploy                  # cluster from Anchor.toml (devnet); read programs/mostro/README.md "Upgrading devnet" first
yarn export:shared             # copy IDL and types into shared/
yarn seed:devnet               # initialize config, artist #0, its token, demo perks; writes shared/addresses/devnet.json
npx ts-node scripts/demo-buy.ts [sol]                # buy, redeem the Classic pass with tokens, buy the hybrid drop with SOL
npx ts-node scripts/demo-one-tx.ts [perkIndex]       # buy exact tokens + redeem the pass in one transaction
npx ts-node scripts/demo-sponsored.ts [perkIndex]    # fan wallet with 0 SOL redeems a perk; the CLI wallet pays as `payer`
npx ts-node scripts/set-blacklist.ts <wallet> true   # block a wallet (everyone is allowed by default)
npx ts-node scripts/set-config.ts key=value ...      # admin switchboard: buysPaused, redeemsPaused, feeBps, launchCooldownSecs, maxSpendPerPeriodLamports, ...
npx ts-node scripts/set-price.ts <0|1> [priceUsd]    # SOL/USD source; refreshes the admin price
npx ts-node scripts/governance.ts <members|proposals|propose-member|propose-transfer|approve|execute|cancel|pause>
```

Devnet status: the deployment at slot 509182643 runs the previous version (bonding curve with sells, KYC gate, on-chain pass benefits). This version has not been deployed yet: the binary grew to 898,712 bytes against 800,000 reserved and every account layout changed, so the upgrade needs `solana program extend` plus a fresh config (see `programs/mostro/README.md`). Verified locally: 12 Rust unit tests, 36 SDK tests and a 30-case integration suite on a surfpool fork of devnet.

Documentation:

- [`programs/mostro/docs/ARCHITECTURE.md`](programs/mostro/docs/ARCHITECTURE.md): fixed numbers, accounts, flows, governance, limitations, roadmap.
- [`programs/mostro/docs/FRONTEND.md`](programs/mostro/docs/FRONTEND.md): handoff for the apps: PDAs, instructions and account order, read patterns, costs, error codes, migration notes.
- [`programs/mostro/README.md`](programs/mostro/README.md): build, test, deploy and upgrade commands.
- [`shared/README.md`](shared/README.md): the TypeScript SDK.
- [`SECURITY.md`](SECURITY.md): security model, authorities, how to report.
- [`CHANGELOG.md`](CHANGELOG.md).

Frontends import the program id, PDAs, IDL and types from the `shared` workspace package (`shared/addresses/devnet.json`, `shared/idl/mostro.json`, `shared/types/mostro.ts`) and never copy constants by hand.

### Design rationale (the questions reviewers ask first)

- **Why is the supply fixed and minted up front?** So that the 28 / 7 / 15 / 50 split is a fact of the mint, not a promise of the program: `create_curve` mints 1B into four vaults and revokes the mint authority in the same instruction. Buys transfer from the hot vault; nothing can ever be minted again.
- **Why no sell?** The primary market supports the price with buys only; holders exit on the DEX after graduation. There is no instruction that pays SOL out of the curve to a user, so the design cannot be switched off by a flag.
- **Who can move the reserves?** Only an executed governance proposal. Members weigh 1 (admin) or 2 (super-admin) and execution needs strictly more than 51 % of the live total weight; the executor recomputes the source vault from the proposal, so a proposal moves exactly what it names. The operator key has no withdrawal path at all.
- **Where does identity live?** Off-chain (Openfort, Sumsub). On-chain there is only a blacklist entry per blocked wallet; everyone else is allowed. Buys and redeems take the buyer's own blacklist PDA, seeds-checked, so it cannot be dodged.
- **How does a paid perk work?** `buy_perk_sol`: half of the SOL buys tokens on the curve (and moves the price like any buy), half goes to the artist wallet; the same number of tokens leaves the artist reserve; all of those tokens are burned 80 % / sent to rewards 20 %. Free-with-tokens perks (`redeem_perk`) apply the same split to the tokens the fan pays.
- **Where did pass benefits go?** To the web app, from the pass asset the wallet holds. The program writes `kind`, `tier`, `artist` and `edition` into the asset's attributes and interprets none of them.
- **Who pays the ~0.006 SOL of rent and Core fee when the wallet is empty?** The `payer` signer, which is separate from `buyer` in every user instruction. Self-paid by default; a sponsor (Openfort, Kora) co-signs in production.
