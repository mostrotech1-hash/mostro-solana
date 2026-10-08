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
