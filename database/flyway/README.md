# Database migrations (Flyway)

Schema changes are SQL files run by Flyway. There is no ORM migration tool.

Two passes (both run by `yarn db:migrate`):

1. `init-app-env/sql` runs against the default `postgres` database as the superuser. It creates `mostro_db` and the `app_user` login.
2. `application/sql` runs against `mostro_db`. It creates the `mostro_app` schema, the tables and the grants.

Current tables: `mostro_app.users` (who signed in through Openfort: login type, email, name, avatar path). Passes live on the blockchain and have no table. Diagram: [`../SCHEMA.md`](../SCHEMA.md) and [`../schema.dbml`](../schema.dbml).

## Run locally (Docker required)

```bash
yarn db:up        # Postgres on localhost:45434
yarn db:migrate   # both Flyway passes, in Docker
```

## Rules

- Never edit a `V*__` file that has already been applied. Add a new one.
- Name new files `V<yyyymmdd><nnnnnn>__<what>.sql`, higher than the last one.
